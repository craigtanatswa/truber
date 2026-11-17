import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'refresh_token_vault.dart';

/// OpenAPI `Error` body plus HTTP status. Message is never shown to users;
/// UI maps [code]/[statusCode] to Design error.* copy.
class ApiException implements Exception {
  ApiException(this.statusCode, this.code, [this.message = '', this.details]);
  final int statusCode;
  final String code;
  final String message;

  /// OpenAPI Error.details (e.g. AccountBannedError bannedUntil/bannedParty).
  final Map<String, dynamic>? details;
  @override
  String toString() => 'ApiException($statusCode, $code)';
}

/// Access token and its expiry live here, in memory. Only the refresh token
/// is written to [vault]. [toString] never includes either token.
class TokenStore {
  TokenStore({RefreshTokenVault? vault})
      : vault = vault ?? MemoryRefreshTokenVault();

  final RefreshTokenVault vault;
  String? accessToken;
  String? refreshToken;
  DateTime? accessExpiresAt;

  bool get hasSession => accessToken != null;

  void apply({
    required String access,
    required String refresh,
    required int expiresInSeconds,
    required DateTime now,
  }) {
    accessToken = access;
    refreshToken = refresh;
    accessExpiresAt = now.add(Duration(seconds: expiresInSeconds));
  }

  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
    accessExpiresAt = null;
    await vault.clear();
  }

  @override
  String toString() =>
      'TokenStore(hasAccess: ${accessToken != null}, hasRefresh: ${refreshToken != null})';
}

/// Thin JSON-over-HTTP client for the Truber API (OpenAPI v0.5.0).
///
/// Access lifetime is `expiresIn` from each token response. Before an authed
/// request the client refreshes when the token is within [refreshLeeway] of
/// that expiry, and on a 401 it refreshes once and retries the original
/// request once. Concurrent callers share one refresh.
///
/// Refresh tokens rotate. A 401 from `/auth/refresh` re-reads [TokenStore.vault]
/// once and retries with a newer token (another tab may have rotated first)
/// before the session is cleared. Only a refresh 401 clears the stored
/// token. Offline, timeout, and 5xx leave it in place. [onSessionExpired]
/// fires when the token is rejected or another tab logs out.
class ApiClient {
  ApiClient({
    required String baseUrl,
    http.Client? httpClient,
    DateTime Function()? clock,
    RefreshTokenVault? refreshTokens,
    this.timeout = const Duration(seconds: 20),
    this.refreshLeeway = const Duration(seconds: 60),
  })  : _base = Uri.parse(baseUrl.endsWith('/')
            ? baseUrl.substring(0, baseUrl.length - 1)
            : baseUrl),
        _http = httpClient ?? http.Client(),
        _clock = clock ?? DateTime.now,
        tokens = TokenStore(vault: refreshTokens) {
    tokens.vault.listenForRemoval(_onRemoteLogout);
  }

  final Uri _base;
  final http.Client _http;
  final DateTime Function() _clock;
  final Duration timeout;
  final Duration refreshLeeway;
  final TokenStore tokens;

  /// Called when an access token was in memory and the refresh token was
  /// rejected, or another tab removed the stored token.
  void Function()? onSessionExpired;

  /// Set when the last refresh failed without deleting the stored token.
  Object? lastRefreshError;

  bool _persistAllowed = true;
  Future<void>? _refreshing;

  DateTime now() => _clock();

  Uri _uri(String path, Map<String, String>? query) {
    final q = <String, String>{...?query}..removeWhere((_, v) => v.isEmpty);
    return _base.replace(
      path: '${_base.path}$path',
      queryParameters: q.isEmpty ? null : q,
    );
  }

  /// Stores tokens from an AuthTokenResponse JSON body.
  /// The access token stays in memory; only the refresh token is persisted.
  ///
  /// [establish] is for login and register. A refresh must not pass it: after
  /// logout, [_persistAllowed] is false and the in-memory token is not written
  /// back over a cleared store.
  Future<void> saveTokens(
    Map<String, dynamic> body, {
    bool establish = false,
  }) async {
    if (establish) _persistAllowed = true;
    if (!_persistAllowed) return;
    final refresh = body['refreshToken'] as String;
    tokens.apply(
      access: body['accessToken'] as String,
      refresh: refresh,
      expiresInSeconds: (body['expiresIn'] as num).toInt(),
      now: now(),
    );
    await tokens.vault.write(refresh);
    if (!_persistAllowed) {
      tokens.accessToken = null;
      tokens.refreshToken = null;
      tokens.accessExpiresAt = null;
      await tokens.vault.clear();
    }
  }

  /// Drops memory and storage. Further refreshes do not write a token back
  /// until the next [saveTokens] with `establish: true`.
  Future<void> abandonSession() async {
    _persistAllowed = false;
    await tokens.clear();
  }

  /// Cold start. When a refresh token is stored and there is no access token,
  /// exchange it. The caller then loads `/auth/me`.
  Future<bool> restoreSession() async {
    if (tokens.hasSession) return true;
    final stored = await tokens.vault.read();
    if (stored == null || stored.isEmpty) return false;
    tokens.refreshToken = stored;
    return _refreshOnce();
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) =>
      send('GET', path, query: query);

  Future<dynamic> post(
    String path, {
    Object? body,
    bool auth = true,
    Map<String, String>? headers,
  }) =>
      send('POST', path, body: body, auth: auth, headers: headers);

  Future<dynamic> send(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    Map<String, String>? headers,
    bool auth = true,
  }) async {
    if (auth) await _ensureFresh();
    var res = await _raw(method, path, body, query, headers, auth);
    if (auth && res.statusCode == 401 && tokens.refreshToken != null) {
      final ok = await _refreshOnce();
      if (ok) res = await _raw(method, path, body, query, headers, auth);
    }
    return _decode(res);
  }

  Future<http.Response> _raw(
    String method,
    String path,
    Object? body,
    Map<String, String>? query,
    Map<String, String>? headers,
    bool auth,
  ) {
    final req = http.Request(method, _uri(path, query));
    req.headers['Accept'] = 'application/json';
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    if (auth && tokens.accessToken != null) {
      req.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
    }
    if (headers != null) req.headers.addAll(headers);
    return _sendGuarded(req);
  }

  /// Listens to the HTTP future before applying the timeout. A browser
  /// `fetch` rejection that arrives after the timeout must not become an
  /// unhandled promise rejection in the web console.
  Future<http.Response> _sendGuarded(http.Request req) {
    final sent = _http.send(req);
    sent.catchError((Object _) {
      return http.StreamedResponse(const Stream<List<int>>.empty(), 599);
    });
    return sent.timeout(timeout).then(http.Response.fromStream);
  }

  dynamic _decode(http.Response res) {
    final text = res.body;
    dynamic json;
    if (text.isNotEmpty) {
      try {
        json = jsonDecode(text);
      } on FormatException {
        json = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return json;
    final code = json is Map && json['code'] is String
        ? json['code'] as String
        : 'HTTP_${res.statusCode}';
    final msg = json is Map && json['message'] is String
        ? json['message'] as String
        : '';
    final details = json is Map && json['details'] is Map<String, dynamic>
        ? json['details'] as Map<String, dynamic>
        : null;
    throw ApiException(res.statusCode, code, msg, details);
  }

  Future<void> _ensureFresh() async {
    final exp = tokens.accessExpiresAt;
    if (exp == null || tokens.refreshToken == null) return;
    if (now().isBefore(exp.subtract(refreshLeeway))) return;
    await _refreshOnce();
  }

  Future<bool> _refreshOnce() async {
    final pending = _refreshing;
    if (pending != null) {
      await pending;
      return tokens.hasSession;
    }
    final done = Completer<void>();
    _refreshing = done.future;
    try {
      return await tokens.vault.runLocked(_refreshLeader);
    } finally {
      await tokens.vault.finishRefresh();
      _refreshing = null;
      if (!done.isCompleted) done.complete();
    }
  }

  Future<bool> _refreshLeader() async {
    try {
      final claimed = await tokens.vault.claimRefresh(tokens.refreshToken);
      if (claimed == null || claimed.isEmpty) {
        if (tokens.refreshToken != null || tokens.hasSession) {
          await _forgetLocalSession();
        }
        return false;
      }
      try {
        await _exchange(claimed);
        lastRefreshError = null;
        return true;
      } on ApiException catch (e) {
        if (e.statusCode == 401) {
          final stored = await tokens.vault.read();
          if (stored != null && stored.isNotEmpty && stored != claimed) {
            try {
              await _exchange(stored);
              lastRefreshError = null;
              return true;
            } on ApiException catch (retry) {
              lastRefreshError = retry;
              if (retry.statusCode == 401) await _failSession();
              return false;
            } catch (retry) {
              lastRefreshError = retry;
              return false;
            }
          }
          lastRefreshError = e;
          await _failSession();
          return false;
        }
        lastRefreshError = e;
        return false;
      } catch (e) {
        lastRefreshError = e;
        return false;
      }
    } catch (e) {
      lastRefreshError = e;
      return false;
    }
  }

  void _onRemoteLogout() {
    _persistAllowed = false;
    final had = tokens.hasSession || tokens.refreshToken != null;
    tokens.accessToken = null;
    tokens.refreshToken = null;
    tokens.accessExpiresAt = null;
    if (had) onSessionExpired?.call();
  }

  Future<void> _forgetLocalSession() async {
    _persistAllowed = false;
    final had = tokens.hasSession || tokens.refreshToken != null;
    tokens.accessToken = null;
    tokens.refreshToken = null;
    tokens.accessExpiresAt = null;
    if (had) onSessionExpired?.call();
  }

  Future<void> _exchange(String refreshToken) async {
    final res = await _raw(
      'POST',
      '/auth/refresh',
      {'refreshToken': refreshToken},
      null,
      null,
      false,
    );
    final body = _decode(res);
    if (body is! Map<String, dynamic>) {
      throw ApiException(res.statusCode, 'HTTP_${res.statusCode}');
    }
    await saveTokens(body);
  }

  Future<void> _failSession() async {
    final hadAccess = tokens.hasSession;
    await abandonSession();
    if (hadAccess) onSessionExpired?.call();
  }
}

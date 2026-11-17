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

/// Thin JSON-over-HTTP client for the Truber API (OpenAPI v0.4.0).
///
/// Access lifetime is `expiresIn` from each token response. Before an authed
/// request the client refreshes when the token is within [refreshLeeway] of
/// that expiry, and on a 401 it refreshes once and retries the original
/// request once. Concurrent callers share one refresh.
///
/// Refresh tokens rotate. A 401 from `/auth/refresh` re-reads [TokenStore.vault]
/// once and retries with a newer token (another tab may have rotated first)
/// before the session is cleared. If refresh fails, storage is wiped and
/// [onSessionExpired] fires.
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
        tokens = TokenStore(vault: refreshTokens);

  final Uri _base;
  final http.Client _http;
  final DateTime Function() _clock;
  final Duration timeout;
  final Duration refreshLeeway;
  final TokenStore tokens;

  /// Called once when an access token was in memory and can no longer be
  /// refreshed. Not called for a cold start that never obtained one.
  void Function()? onSessionExpired;

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
  Future<void> saveTokens(Map<String, dynamic> body) async {
    final refresh = body['refreshToken'] as String;
    tokens.apply(
      access: body['accessToken'] as String,
      refresh: refresh,
      expiresInSeconds: (body['expiresIn'] as num).toInt(),
      now: now(),
    );
    await tokens.vault.write(refresh);
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
    return _http.send(req).then(http.Response.fromStream).timeout(timeout);
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
      try {
        final claimed = await tokens.vault.claimRefresh(tokens.refreshToken);
        if (claimed == null || claimed.isEmpty) {
          await _failSession();
          return false;
        }
        try {
          await _exchange(claimed);
          return true;
        } on ApiException catch (e) {
          if (e.statusCode == 401) {
            final stored = await tokens.vault.read();
            if (stored != null && stored.isNotEmpty && stored != claimed) {
              try {
                await _exchange(stored);
                return true;
              } catch (_) {
                await _failSession();
                return false;
              }
            }
          }
          await _failSession();
          return false;
        } catch (_) {
          await _failSession();
          return false;
        }
      } catch (_) {
        await _failSession();
        return false;
      }
    } finally {
      await tokens.vault.finishRefresh();
      _refreshing = null;
      if (!done.isCompleted) done.complete();
    }
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
    await tokens.clear();
    if (hadAccess) onSessionExpired?.call();
  }
}

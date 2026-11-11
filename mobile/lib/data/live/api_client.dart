import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

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

/// Holds the current session tokens in memory only (not persisted).
/// Refresh tokens are opaque and never logged.
class TokenStore {
  String? accessToken;
  String? refreshToken;
  DateTime? accessExpiresAt;

  bool get hasSession => accessToken != null;

  void save({
    required String access,
    required String refresh,
    required int expiresInSeconds,
    required DateTime now,
  }) {
    accessToken = access;
    refreshToken = refresh;
    accessExpiresAt = now.add(Duration(seconds: expiresInSeconds));
  }

  void clear() {
    accessToken = null;
    refreshToken = null;
    accessExpiresAt = null;
  }
}

/// Thin JSON-over-HTTP client for the Truber API (OpenAPI v0.4.0).
///
/// Access tokens last `expiresIn` seconds (1800). Before an authed request the
/// client refreshes when the token is within [refreshLeeway] of expiry, and on
/// a 401 it refreshes once and retries. Concurrent callers share one refresh.
/// If refresh fails the session is cleared and [onSessionExpired] fires.
class ApiClient {
  ApiClient({
    required String baseUrl,
    http.Client? httpClient,
    DateTime Function()? clock,
    this.timeout = const Duration(seconds: 20),
    this.refreshLeeway = const Duration(seconds: 60),
  })  : _base = Uri.parse(baseUrl.endsWith('/')
            ? baseUrl.substring(0, baseUrl.length - 1)
            : baseUrl),
        _http = httpClient ?? http.Client(),
        _clock = clock ?? DateTime.now;

  final Uri _base;
  final http.Client _http;
  final DateTime Function() _clock;
  final Duration timeout;
  final Duration refreshLeeway;
  final TokenStore tokens = TokenStore();

  /// Called once when the session can no longer be refreshed.
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
  void saveTokens(Map<String, dynamic> body) {
    tokens.save(
      access: body['accessToken'] as String,
      refresh: body['refreshToken'] as String,
      expiresInSeconds: (body['expiresIn'] as num).toInt(),
      now: now(),
    );
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
    final completer = Completer<void>();
    _refreshing = completer.future;
    try {
      final refresh = tokens.refreshToken;
      if (refresh == null) throw ApiException(401, 'UNAUTHORIZED');
      final res = await _raw(
        'POST',
        '/auth/refresh',
        {'refreshToken': refresh},
        null,
        null,
        false,
      );
      final body = _decode(res) as Map<String, dynamic>;
      saveTokens(body);
      return true;
    } catch (_) {
      final hadSession = tokens.hasSession;
      tokens.clear();
      if (hadSession) onSessionExpired?.call();
      return false;
    } finally {
      _refreshing = null;
      completer.complete();
    }
  }
}

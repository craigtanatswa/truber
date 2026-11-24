import 'dart:math';

import 'package:flutter/foundation.dart';

import '../../config/flags.dart';
import '../../models/user.dart';
import '../repositories/auth_repository.dart';
import 'mock_seed.dart';

class _ResetRecord {
  _ResetRecord({
    required this.token,
    required this.email,
    required this.issuedAt,
    required this.expiresAt,
  });

  final String token;
  final String email;
  final DateTime issuedAt;
  final DateTime expiresAt;
  bool consumed = false;
}

/// In-memory auth matching OpenAPI Auth paths (v0.2.0). Swap for HTTP when live.
class MockAuthRepository implements AuthRepository {
  MockAuthRepository({Random? random, DateTime Function()? clock})
      : _random = random ?? Random(),
        _clock = clock ?? (() => DateTime.now().toUtc()) {
    for (final u in seedUsers()) {
      _users[u.email.toLowerCase()] = u;
      _passwords[u.email.toLowerCase()] = demoPassword;
    }
  }

  static const demoPassword = 'demopass';
  static const demoOtpCode = '123456';

  /// OpenAPI PasswordResetToken TTL (30m) — distinct from access expiresIn (Charlie: 30m / 1800s).
  static const resetTokenTtl = Duration(minutes: 30);

  static const maxCityLength = 120;

  final Random _random;
  final DateTime Function() _clock;

  final Map<String, TruberUser> _users = {};
  final Map<String, String> _passwords = {};

  /// RegisterRequest.city held until company create (User schema has no city).
  final Map<String, String> _registerCities = {};

  /// token → record (single-use + TTL)
  final Map<String, _ResetRecord> _resetByToken = {};

  /// email → current outstanding (unconsumed) token, if any
  final Map<String, String> _activeResetTokenByEmail = {};

  /// Last demo-only revealed token (never returned by request API).
  String? _lastDemoResetToken;
  TruberUser? _user;
  String? _accessToken;
  String? _pendingOtpUserId;

  @override
  Future<TruberUser?> currentUser() async => _user;

  @override
  Future<AuthTokenResponse> login({
    required String email,
    required String password,
  }) async {
    final key = email.trim().toLowerCase();
    final found = _users[key];
    if (found == null || _passwords[key] != password) {
      throw AuthException('Invalid email or password.');
    }
    return _issue(found);
  }

  @override
  Future<AuthTokenResponse> register({
    required String email,
    required String password,
    required String fullName,
    required UserRole role,
    String? phone,
    String? city,
  }) async {
    if (role == UserRole.admin) {
      throw AuthException('Public signup never grants admin.');
    }
    if (password.length < 8) {
      throw AuthException('Password must be at least 8 characters.');
    }
    final key = email.trim().toLowerCase();
    if (_users.containsKey(key)) {
      throw AuthException('Email already registered.');
    }
    final normalizedCity = normalizeCity(city);
    final now = _clock();
    final user = TruberUser(
      id: '00000000-0000-4000-8000-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      email: key,
      fullName: fullName,
      phone: phone?.trim().isEmpty == true ? null : phone?.trim(),
      role: role,
      accountStatus: AccountStatus.pendingVerification,
      createdAt: now,
      updatedAt: now,
    );
    _users[key] = user;
    _passwords[key] = password;
    if (normalizedCity != null) {
      _registerCities[user.id] = normalizedCity;
    }
    return _issue(user);
  }

  /// Trim; empty → null; nonempty must be 1–120 chars (OpenAPI city).
  static String? normalizeCity(String? city) {
    if (city == null) return null;
    final trimmed = city.trim();
    if (trimmed.isEmpty) return null;
    if (trimmed.length > maxCityLength) {
      throw AuthException('CITY_TOO_LONG');
    }
    return trimmed;
  }

  @override
  Future<PasswordResetRequestAccepted> requestPasswordReset({
    required String email,
  }) async {
    final key = email.trim().toLowerCase();
    if (_users.containsKey(key)) {
      // Invalidate previous outstanding token without resurrecting consumed ones.
      final prev = _activeResetTokenByEmail.remove(key);
      if (prev != null) {
        final old = _resetByToken[prev];
        if (old != null && !old.consumed) {
          old.consumed = true; // supersede — cannot reuse prior credential
        }
      }
      final token = _opaqueToken();
      final now = _clock();
      final record = _ResetRecord(
        token: token,
        email: key,
        issuedAt: now,
        expiresAt: now.add(resetTokenTtl),
      );
      _resetByToken[token] = record;
      _activeResetTokenByEmail[key] = token;
      // Demo-only: stash for gated reveal — never in API response.
      if (kTruberDemo) {
        _lastDemoResetToken = token;
        // ignore: avoid_print
        print('TRUBER_DEMO password-reset token for $key: $token');
      }
    }
    return const PasswordResetRequestAccepted();
  }

  @override
  Future<PasswordResetConfirmResponse> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    final record = _resetByToken[token];
    final now = _clock();
    if (record == null || record.consumed || !now.isBefore(record.expiresAt)) {
      throw AuthException('PASSWORD_RESET_TOKEN_INVALID');
    }
    if (newPassword.length < 8) {
      throw AuthException('Password must be at least 8 characters.');
    }
    record.consumed = true;
    if (_activeResetTokenByEmail[record.email] == token) {
      _activeResetTokenByEmail.remove(record.email);
    }
    _passwords[record.email] = newPassword;
    if (_user?.email == record.email) {
      _user = null;
      _accessToken = null;
    }
    return const PasswordResetConfirmResponse();
  }

  @override
  Future<OtpRequestResponse> requestOtp({String channel = 'sms'}) async {
    if (_user == null) {
      throw AuthException('Not authenticated.');
    }
    _pendingOtpUserId = _user!.id;
    return const OtpRequestResponse(status: 'stubbed', expiresInSeconds: 600);
  }

  @override
  Future<TruberUser> verifyOtp({required String code}) async {
    if (_user == null) {
      throw AuthException('Not authenticated.');
    }
    if (_pendingOtpUserId != _user!.id) {
      throw AuthException('No OTP pending.');
    }
    if (code.trim() != demoOtpCode) {
      throw AuthException('OTP_WRONG');
    }
    final key = _user!.email.toLowerCase();
    final updated = _user!.copyWith(
      accountStatus: AccountStatus.pendingVerification,
      updatedAt: _clock(),
    );
    _users[key] = updated;
    _user = updated;
    _pendingOtpUserId = null;
    return updated;
  }

  @override
  Future<void> logout() async {
    _user = null;
    _accessToken = null;
    _pendingOtpUserId = null;
  }

  /// Demo-only peek at last issued reset token. Returns null unless [kTruberDemo].
  String? demoPeekLastResetToken() {
    if (!kTruberDemo) return null;
    return _lastDemoResetToken;
  }

  /// Test-only accessor — not used by UI (QA-031). Prefer over email→token in screens.
  @visibleForTesting
  String? testingActiveResetTokenFor(String email) =>
      _activeResetTokenByEmail[email.trim().toLowerCase()];

  String? registerCityFor(String userId) => _registerCities[userId];

  String _opaqueToken() {
    // ≥32 non-whitespace chars; unique per issuance (not email-derived).
    final buf = StringBuffer('truber-reset-');
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 40; i++) {
      buf.write(chars[_random.nextInt(chars.length)]);
    }
    return buf.toString();
  }

  AuthTokenResponse _issue(TruberUser user) {
    _user = user;
    _accessToken = 'mock-access-${user.id}';
    return AuthTokenResponse(
      accessToken: _accessToken!,
      refreshToken: 'mock-refresh-${user.id}',
      expiresIn: 1800,
      user: user,
    );
  }
}

class AuthException implements Exception {
  AuthException(this.message);
  final String message;
  @override
  String toString() => message;
}

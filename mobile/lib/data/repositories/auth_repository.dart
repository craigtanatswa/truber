import '../../models/user.dart';

/// OpenAPI Auth: login, register, password-reset, OTP (v0.2.0).
abstract class AuthRepository {
  Future<TruberUser?> currentUser();

  Future<AuthTokenResponse> login({
    required String email,
    required String password,
  });

  Future<AuthTokenResponse> register({
    required String email,
    required String password,
    required String fullName,
    required UserRole role,
    String? phone,
    String? city,
  });

  /// POST /auth/password-reset/request — always accepted (anti-enumeration).
  Future<PasswordResetRequestAccepted> requestPasswordReset({
    required String email,
  });

  /// POST /auth/password-reset/confirm
  Future<PasswordResetConfirmResponse> confirmPasswordReset({
    required String token,
    required String newPassword,
  });

  /// POST /auth/otp/request (bearer).
  Future<OtpRequestResponse> requestOtp({String channel = 'sms'});

  /// POST /auth/otp/verify (bearer). Returns updated User.
  Future<TruberUser> verifyOtp({required String code});

  Future<void> logout();
}

class PasswordResetRequestAccepted {
  const PasswordResetRequestAccepted({
    this.status = 'accepted',
    this.message =
        'If an account exists for this email, password reset instructions will be sent when permitted.',
  });

  final String status;
  final String message;
}

class PasswordResetConfirmResponse {
  const PasswordResetConfirmResponse({
    this.status = 'password_changed',
    this.refreshSessionsInvalidated = true,
  });

  final String status;
  final bool refreshSessionsInvalidated;
}

class OtpRequestResponse {
  const OtpRequestResponse({
    required this.status,
    required this.expiresInSeconds,
  });

  /// OpenAPI: dispatched | stubbed
  final String status;
  final int expiresInSeconds;
}

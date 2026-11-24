/// OpenAPI: User, UserRole, AccountStatus, PublicSignupRole.
enum UserRole { shipper, transporter, admin }

enum AccountStatus { pendingVerification, active, suspended, disabled }

class TruberUser {
  const TruberUser({
    required this.id,
    required this.email,
    required this.fullName,
    required this.role,
    required this.accountStatus,
    required this.createdAt,
    required this.updatedAt,
    this.phone,
    this.bannedUntil,
  });

  final String id;
  final String email;
  final String fullName;
  final String? phone;
  final UserRole role;
  final AccountStatus accountStatus;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// OpenAPI User.bannedUntil: endsAt of the active off-platform ban, or null.
  final DateTime? bannedUntil;

  bool get isActive => accountStatus == AccountStatus.active;

  TruberUser copyWith({
    String? phone,
    AccountStatus? accountStatus,
    DateTime? updatedAt,
  }) {
    return TruberUser(
      id: id,
      email: email,
      fullName: fullName,
      phone: phone ?? this.phone,
      role: role,
      accountStatus: accountStatus ?? this.accountStatus,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      bannedUntil: bannedUntil,
    );
  }
}

class AuthTokenResponse {
  const AuthTokenResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
    this.tokenType = 'Bearer',
  });

  final String accessToken;
  final String refreshToken;
  final String tokenType;
  final int expiresIn;
  final TruberUser user;
}

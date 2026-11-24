/// OpenAPI: Company, CompanyType, VerificationStatus.
enum CompanyType { shipper, transporter }

enum VerificationStatus { unverified, pending, verified, rejected }

class Company {
  const Company({
    required this.id,
    required this.type,
    required this.legalName,
    required this.verificationStatus,
    required this.createdAt,
    required this.updatedAt,
    this.tradingName,
    this.registrationNumber,
    this.taxNumber,
    this.countryCode = 'ZW',
    this.city,
    this.bannedUntil,
  });

  final String id;
  final CompanyType type;
  final String legalName;
  final String? tradingName;
  final String? registrationNumber;
  final String? taxNumber;
  final String countryCode;
  final String? city;
  final VerificationStatus verificationStatus;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// OpenAPI Company.bannedUntil: endsAt of the active off-platform ban, or null.
  final DateTime? bannedUntil;
}

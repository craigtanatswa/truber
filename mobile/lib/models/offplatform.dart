/// OpenAPI v0.4.0 off-platform report (party-facing fields only; `finding`
/// is admin-only and its reason is never shown to parties).
enum SuspectedParty { shipper, transporter, both, unknown }

enum OffPlatformReportStatus { open, confirmed, notConfirmed }

OffPlatformReportStatus reportStatusFromApi(String v) => switch (v) {
      'confirmed' => OffPlatformReportStatus.confirmed,
      'not_confirmed' => OffPlatformReportStatus.notConfirmed,
      _ => OffPlatformReportStatus.open,
    };

class OffPlatformReport {
  const OffPlatformReport({
    required this.id,
    required this.bookingId,
    required this.suspectedParty,
    required this.description,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String bookingId;
  final SuspectedParty suspectedParty;
  final String description;
  final OffPlatformReportStatus status;
  final DateTime createdAt;
}

/// CreateOffPlatformReportRequest.description minLength.
const offPlatformDescriptionMin = 10;
const offPlatformDescriptionMax = 4000;

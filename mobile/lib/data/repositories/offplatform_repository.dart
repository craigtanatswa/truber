import '../../models/offplatform.dart';

abstract class OffPlatformReportRepository {
  /// POST /bookings/{bookingId}/off-platform-reports
  Future<OffPlatformReport> create(
    String bookingId, {
    required SuspectedParty suspectedParty,
    required String description,
  });

  /// Reports this user filed on the booking. OpenAPI v0.4.0 has no
  /// party-facing read endpoint, so live returns only reports created in
  /// this session (status as returned at creation).
  Future<List<OffPlatformReport>> forBooking(String bookingId);
}

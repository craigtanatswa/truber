import '../../models/offplatform.dart';
import '../repositories/offplatform_repository.dart';
import 'api_client.dart';

class LiveOffPlatformReportRepository implements OffPlatformReportRepository {
  LiveOffPlatformReportRepository(this.api);
  final ApiClient api;
  final List<OffPlatformReport> _created = [];

  @override
  Future<OffPlatformReport> create(
    String bookingId, {
    required SuspectedParty suspectedParty,
    required String description,
  }) async {
    final j = await api.post(
      '/bookings/${Uri.encodeComponent(bookingId)}/off-platform-reports',
      body: {
        'suspectedParty': suspectedParty.name,
        'description': description.trim(),
      },
    ) as Map<String, dynamic>;
    final r = OffPlatformReport(
      id: j['id'] as String,
      bookingId: j['bookingId'] as String,
      suspectedParty: SuspectedParty.values.firstWhere(
          (e) => e.name == j['suspectedParty'],
          orElse: () => SuspectedParty.unknown),
      description: j['description'] as String,
      status: reportStatusFromApi(j['status'] as String),
      createdAt: DateTime.parse(j['createdAt'] as String),
    );
    _created.add(r);
    return r;
  }

  /// No party-facing GET in v0.4.0: session-local list only.
  @override
  Future<List<OffPlatformReport>> forBooking(String bookingId) async =>
      _created.where((r) => r.bookingId == bookingId).toList();
}

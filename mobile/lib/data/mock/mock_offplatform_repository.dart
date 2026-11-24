import '../../models/offplatform.dart';
import '../repositories/offplatform_repository.dart';

class MockOffPlatformReportRepository implements OffPlatformReportRepository {
  MockOffPlatformReportRepository() {
    _reports.addAll(seedOffPlatformReports());
  }
  final List<OffPlatformReport> _reports = [];

  @override
  Future<OffPlatformReport> create(
    String bookingId, {
    required SuspectedParty suspectedParty,
    required String description,
  }) async {
    final d = description.trim();
    if (d.length < offPlatformDescriptionMin ||
        d.length > offPlatformDescriptionMax) {
      throw ArgumentError('description length');
    }
    final now = DateTime.now().toUtc();
    final r = OffPlatformReport(
      id: '77777777-7777-4777-8777-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      bookingId: bookingId,
      suspectedParty: suspectedParty,
      description: d,
      status: OffPlatformReportStatus.open,
      createdAt: now,
    );
    _reports.add(r);
    return r;
  }

  @override
  Future<List<OffPlatformReport>> forBooking(String bookingId) async =>
      _reports.where((r) => r.bookingId == bookingId).toList();
}

/// Spec-shaped examples so every status chip is visible in the demo.
List<OffPlatformReport> seedOffPlatformReports() => [
      OffPlatformReport(
        id: '77777777-7777-4777-8777-777777777771',
        bookingId: '44444444-4444-4444-8444-444444444442',
        suspectedParty: SuspectedParty.shipper,
        description: 'Shipper asked to settle the balance in cash directly.',
        status: OffPlatformReportStatus.notConfirmed,
        createdAt: DateTime.utc(2026, 11, 8, 9),
      ),
      OffPlatformReport(
        id: '77777777-7777-4777-8777-777777777773',
        bookingId: '44444444-4444-4444-8444-444444444447',
        suspectedParty: SuspectedParty.unknown,
        description:
            'Someone called offering to pay the fare by bank transfer.',
        status: OffPlatformReportStatus.open,
        createdAt: DateTime.utc(2026, 11, 9, 11),
      ),
      OffPlatformReport(
        id: '77777777-7777-4777-8777-777777777772',
        bookingId: '44444444-4444-4444-8444-444444444444',
        suspectedParty: SuspectedParty.shipper,
        description: 'Shipper cancelled, then offered the same load by phone.',
        status: OffPlatformReportStatus.confirmed,
        createdAt: DateTime.utc(2026, 11, 7, 15),
      ),
    ];

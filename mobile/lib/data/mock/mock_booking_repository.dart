import '../../models/booking.dart';
import '../repositories/booking_repository.dart';
import 'mock_stores.dart';

class MockBookingRepository implements BookingRepository {
  final _store = MockStores.instance;

  @override
  Future<Booking> getById(String bookingId) async {
    return _store.bookings.firstWhere((b) => b.id == bookingId);
  }

  @override
  Future<List<Booking>> listForShipperCompany(String companyId) async {
    return _store.bookings
        .where((b) => b.shipperCompanyId == companyId)
        .toList();
  }

  @override
  Future<Booking> confirm(String bookingId, {String? idempotencyKey}) async {
    final i = _store.bookings.indexWhere((b) => b.id == bookingId);
    if (i < 0) throw StateError('Booking not found');
    final booking = _store.bookings[i];
    if (booking.status == BookingStatus.confirmed) return booking;
    if (booking.status != BookingStatus.pendingPaymentArrangement) {
      throw BookingGateException('Booking cannot be confirmed in this state.');
    }
    final arrangement = _store.arrangements
        .where((a) => a.bookingId == bookingId && a.isConfirmed)
        .toList();
    if (arrangement.isEmpty) {
      throw BookingGateException(
        'No confirmed payment arrangement — no confirmed booking.',
      );
    }
    final now = DateTime.now().toUtc();
    final confirmed = booking.copyWith(
      status: BookingStatus.confirmed,
      confirmedPaymentArrangementId: arrangement.first.id,
      confirmedAt: now,
      updatedAt: now,
    );
    _store.bookings[i] = confirmed;
    return confirmed;
  }
}

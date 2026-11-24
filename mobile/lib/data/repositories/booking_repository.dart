import '../../models/booking.dart';

abstract class BookingRepository {
  Future<Booking> getById(String bookingId);
  Future<List<Booking>> listForShipperCompany(String companyId);

  /// Confirms booking only when a payment arrangement is server-confirmed.
  /// Throws [BookingGateException] if arrangement is missing or not confirmed.
  Future<Booking> confirm(String bookingId, {String? idempotencyKey});
}

class BookingGateException implements Exception {
  BookingGateException(this.message);
  final String message;
  @override
  String toString() => message;
}

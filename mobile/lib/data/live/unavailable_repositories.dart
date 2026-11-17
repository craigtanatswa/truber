import '../../models/booking.dart';
import '../../models/payment.dart';
import '../repositories/booking_repository.dart';
import '../repositories/payment_repository.dart';
import 'api_client.dart';

/// Live-mode stand-ins for flows the test backend does not serve yet
/// (bookings, payment arrangements). They fail visibly instead of faking
/// success against live IDs. Quotations use LiveQuotationRepository.
ApiException _unavailable() =>
    ApiException(501, 'NOT_AVAILABLE_IN_TEST_BACKEND');

class UnavailableBookingRepository implements BookingRepository {
  @override
  Future<Booking> getById(String bookingId) async => throw _unavailable();
  @override
  Future<List<Booking>> listForShipperCompany(String companyId) async =>
      throw _unavailable();
  @override
  Future<Booking> confirm(String bookingId, {String? idempotencyKey}) async =>
      throw _unavailable();
}

class UnavailablePaymentRepository implements PaymentRepository {
  @override
  Future<List<PaymentArrangement>> forBooking(String bookingId) async =>
      throw _unavailable();
  @override
  Future<PaymentArrangement> propose(
          String bookingId, CreatePaymentArrangementRequest request) async =>
      throw _unavailable();
  @override
  Future<PaymentArrangement?> latestForBooking(String bookingId) async =>
      throw _unavailable();
}

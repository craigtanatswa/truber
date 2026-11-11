import '../../models/booking.dart';
import '../../models/payment.dart';
import '../../models/quotation.dart';
import '../repositories/booking_repository.dart';
import '../repositories/payment_repository.dart';
import '../repositories/quotation_repository.dart';
import 'api_client.dart';

/// Live-mode stand-ins for flows the test backend does not serve yet
/// (quotations, bookings, payment arrangements). They fail visibly instead of
/// faking success against live load IDs. Replace with HTTP clients when the
/// backend implements these OpenAPI v0.4.0 paths.
ApiException _unavailable() =>
    ApiException(501, 'NOT_AVAILABLE_IN_TEST_BACKEND');

class UnavailableQuotationRepository implements QuotationRepository {
  @override
  Future<List<Quotation>> forLoad(String loadId) async => throw _unavailable();
  @override
  Future<Quotation> submit(
          String loadId, CreateQuotationRequest request) async =>
      throw _unavailable();
  @override
  Future<AcceptQuotationResponse> accept(String quotationId,
          {String? notes}) async =>
      throw _unavailable();
}

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

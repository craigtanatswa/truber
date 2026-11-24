import '../../models/payment.dart';

abstract class PaymentRepository {
  Future<List<PaymentArrangement>> forBooking(String bookingId);
  Future<PaymentArrangement> propose(
    String bookingId,
    CreatePaymentArrangementRequest request,
  );
  Future<PaymentArrangement?> latestForBooking(String bookingId);
}

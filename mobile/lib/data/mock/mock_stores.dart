import '../../models/booking.dart';
import '../../models/payment.dart';
import '../../models/quotation.dart';
import 'mock_seed.dart';

/// Shared in-memory stores so quotation accept, payment, and booking stay in sync.
class MockStores {
  MockStores._() {
    quotations.addAll(seedQuotations());
  }

  static final MockStores instance = MockStores._();

  final List<Quotation> quotations = [];
  final List<Booking> bookings = [];
  final List<PaymentArrangement> arrangements = [];

  /// When true (default), propose() auto-simulates admin/ops confirm for demo UX.
  /// Tests that assert the booking gate set this to false.
  bool autoConfirmArrangements = true;
}

import '../../models/payment.dart';
import '../repositories/payment_repository.dart';
import 'mock_stores.dart';

class MockPaymentRepository implements PaymentRepository {
  final _store = MockStores.instance;

  @override
  Future<List<PaymentArrangement>> forBooking(String bookingId) async {
    return _store.arrangements.where((a) => a.bookingId == bookingId).toList();
  }

  @override
  Future<PaymentArrangement?> latestForBooking(String bookingId) async {
    final list = await forBooking(bookingId);
    if (list.isEmpty) return null;
    return list.last;
  }

  @override
  Future<PaymentArrangement> propose(
    String bookingId,
    CreatePaymentArrangementRequest request,
  ) async {
    if (request.method == PaymentMethod.depositBalance) {
      if (request.depositAmount == null || request.balanceAmount == null) {
        throw ArgumentError(
          'deposit_balance requires depositAmount and balanceAmount',
        );
      }
      if (request.depositAmount!.amountMinor < 1 ||
          request.balanceAmount!.amountMinor < 1) {
        throw ArgumentError('depositAmount and balanceAmount must be >= 1');
      }
      final sum = request.depositAmount!.amountMinor +
          request.balanceAmount!.amountMinor;
      if (sum != request.totalAmount.amountMinor) {
        throw ArgumentError('deposit + balance must equal totalAmount');
      }
    }
    if (request.method == PaymentMethod.corporateCredit &&
        request.corporateCreditTermsDays == null) {
      throw ArgumentError('corporate_credit requires corporateCreditTermsDays');
    }

    final now = DateTime.now().toUtc();
    var arrangement = PaymentArrangement(
      id: '50000000-0000-4000-8000-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      bookingId: bookingId,
      method: request.method,
      arrangementStatus: ArrangementStatus.proposed,
      protectionStatus: request.method == PaymentMethod.cash
          ? ProtectionStatus.none
          : ProtectionStatus.pendingEvidence,
      releaseStatus: request.method == PaymentMethod.cash
          ? ReleaseStatus.notApplicable
          : ReleaseStatus.held,
      totalAmount: request.totalAmount,
      depositAmount: request.depositAmount,
      balanceAmount: request.balanceAmount,
      corporateCreditTermsDays: request.corporateCreditTermsDays,
      providerHint: request.providerHint,
      createdAt: now,
      updatedAt: now,
    );
    _store.arrangements.add(arrangement);

    // Mock ops: auto-confirm for demo unless tests disable it.
    // Cash stays unprotected. Escrow becomes protected (evidence simulated).
    if (_store.autoConfirmArrangements) {
      arrangement = _simulateOpsConfirm(arrangement);
      _store.arrangements[_store.arrangements.length - 1] = arrangement;
    }
    return arrangement;
  }

  PaymentArrangement _simulateOpsConfirm(PaymentArrangement a) {
    final now = DateTime.now().toUtc();
    final protection = a.method == PaymentMethod.cash
        ? ProtectionStatus.none
        : ProtectionStatus.protected;
    return a.copyWith(
      arrangementStatus: ArrangementStatus.confirmed,
      protectionStatus: protection,
      confirmedAt: now,
      confirmedByUserId: '33333333-3333-4333-8333-333333333333', // mock admin
      updatedAt: now,
    );
  }
}

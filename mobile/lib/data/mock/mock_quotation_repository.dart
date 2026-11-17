import '../../models/booking.dart';
import '../../models/money.dart';
import '../../models/quotation.dart';
import '../repositories/load_repository.dart';
import '../repositories/quotation_repository.dart';
import 'mock_payout_repository.dart';
import 'mock_seed.dart';
import 'mock_stores.dart';

/// Half-up 5% (`commissionRateBps` 500), integer minor units.
/// Matches OpenAPI v0.5.0 payout-preview examples (100000 → 5000, 25010 → 1251).
int mockCommissionMinor(int amountMinor) =>
    (amountMinor * seedCommissionRateBps + 5000) ~/ 10000;

class MockQuotationRepository implements QuotationRepository {
  MockQuotationRepository({
    LoadRepository? loads,
    this.payoutPreviewEnabled = true,
  }) : _loads = loads;

  final LoadRepository? _loads;

  /// When false, [previewPayout] fails and the quote hint stays hidden.
  final bool payoutPreviewEnabled;
  final _store = MockStores.instance;

  @override
  Future<List<Quotation>> forLoad(String loadId) async {
    return _store.quotations.where((q) => q.loadId == loadId).toList();
  }

  @override
  Future<Quotation> getById(String quotationId) async {
    final i = _store.quotations.indexWhere((q) => q.id == quotationId);
    if (i < 0) throw StateError('Quotation not found');
    return _store.quotations[i];
  }

  @override
  Future<Quotation> submit(
      String loadId, CreateQuotationRequest request) async {
    final now = DateTime.now().toUtc();
    final companies = {for (final c in seedCompanies()) c.id: c};
    final created = Quotation(
      id: '20000000-0000-4000-8000-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      loadId: loadId,
      transporterCompanyId: request.transporterCompanyId,
      truckId: request.truckId,
      amount: request.amount,
      status: QuotationStatus.submitted,
      notes: request.notes,
      validUntil: request.validUntil,
      createdAt: now,
      updatedAt: now,
      transporterLegalName: companies[request.transporterCompanyId]?.legalName,
    );
    _store.quotations.add(created);
    return created;
  }

  @override
  Future<Quotation> withdraw(String quotationId) async {
    final i = _store.quotations.indexWhere((q) => q.id == quotationId);
    if (i < 0) throw StateError('Quotation not found');
    final q = _store.quotations[i];
    if (q.status == QuotationStatus.accepted) {
      throw StateError('SELF_CANCEL_NOT_ALLOWED');
    }
    if (q.status != QuotationStatus.submitted) {
      throw StateError('QUOTATION_NOT_WITHDRAWABLE');
    }
    final withdrawn = q.copyWith(
      status: QuotationStatus.withdrawn,
      updatedAt: DateTime.now().toUtc(),
    );
    _store.quotations[i] = withdrawn;
    return withdrawn;
  }

  @override
  Future<List<Quotation>> restoreNotSelected(String loadId,
      {String? reason}) async {
    final now = DateTime.now().toUtc();
    final restored = <Quotation>[];
    for (var j = 0; j < _store.quotations.length; j++) {
      final other = _store.quotations[j];
      if (other.loadId == loadId &&
          other.status == QuotationStatus.notSelected) {
        final next = other.copyWith(
          status: QuotationStatus.submitted,
          updatedAt: now,
        );
        _store.quotations[j] = next;
        restored.add(next);
      }
    }
    return restored;
  }

  @override
  Future<PayoutPreview> previewPayout(PayoutPreviewRequest request) async {
    if (!payoutPreviewEnabled) {
      throw StateError('NO_PREVIEW');
    }
    final amount = request.amount;
    final commission = mockCommissionMinor(amount.amountMinor);
    final cash = request.paymentMethod == 'cash';
    return PayoutPreview(
      agreedAmount: amount,
      commissionRateBps: seedCommissionRateBps,
      commissionAmount:
          MoneyAmount(amountMinor: commission, currency: amount.currency),
      knownFeesTotal: MoneyAmount(amountMinor: 0, currency: amount.currency),
      netPayoutBeforeUnknownFees: MoneyAmount(
        amountMinor: amount.amountMinor - commission,
        currency: amount.currency,
      ),
      feeStatus: cash ? 'not_applicable' : 'unknown',
      paymentMethod: request.paymentMethod,
      farePayoutDueThroughTruber: !cash,
      paymentProtectedPossible: !cash,
      submissionBlockers: const [],
    );
  }

  @override
  Future<AcceptQuotationResponse> accept(
    String quotationId, {
    String? notes,
  }) async {
    final i = _store.quotations.indexWhere((q) => q.id == quotationId);
    if (i < 0) throw StateError('Quotation not found');
    final q = _store.quotations[i];
    if (q.status != QuotationStatus.submitted) {
      throw StateError('Quotation is not open for acceptance');
    }
    final now = DateTime.now().toUtc();
    final accepted = q.copyWith(
      status: QuotationStatus.accepted,
      notes: notes ?? q.notes,
      updatedAt: now,
    );
    _store.quotations[i] = accepted;

    // Sibling open quotes → not_selected (OpenAPI v0.2.0 / QA-029).
    for (var j = 0; j < _store.quotations.length; j++) {
      final other = _store.quotations[j];
      if (other.loadId == q.loadId &&
          other.id != q.id &&
          other.status == QuotationStatus.submitted) {
        _store.quotations[j] = other.copyWith(
          status: QuotationStatus.notSelected,
          updatedAt: now,
        );
      }
    }

    final load = await _loads?.getById(q.loadId);
    final booking = Booking(
      id: '40000000-0000-4000-8000-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      loadId: q.loadId,
      quotationId: q.id,
      shipperCompanyId: load?.companyId ?? MockIds.shipperCompany,
      transporterCompanyId: q.transporterCompanyId,
      truckId: q.truckId,
      status: BookingStatus.pendingPaymentArrangement,
      tripStatus: TripStatus.notStarted,
      completionStatus: CompletionStatus.notComplete,
      agreedAmount: q.amount,
      commissionRateBps: 500,
      createdAt: now,
      updatedAt: now,
    );
    _store.bookings.add(booking);
    return AcceptQuotationResponse(quotation: accepted, booking: booking);
  }
}

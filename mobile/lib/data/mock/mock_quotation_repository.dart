import '../../models/booking.dart';
import '../../models/quotation.dart';
import '../repositories/load_repository.dart';
import '../repositories/quotation_repository.dart';
import 'mock_seed.dart';
import 'mock_stores.dart';

class MockQuotationRepository implements QuotationRepository {
  MockQuotationRepository({LoadRepository? loads}) : _loads = loads;

  final LoadRepository? _loads;
  final _store = MockStores.instance;

  @override
  Future<List<Quotation>> forLoad(String loadId) async {
    return _store.quotations.where((q) => q.loadId == loadId).toList();
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
    final accepted = Quotation(
      id: q.id,
      loadId: q.loadId,
      transporterCompanyId: q.transporterCompanyId,
      truckId: q.truckId,
      amount: q.amount,
      status: QuotationStatus.accepted,
      notes: notes ?? q.notes,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
      updatedAt: now,
      transporterLegalName: q.transporterLegalName,
    );
    _store.quotations[i] = accepted;

    // Sibling open quotes → not_selected (OpenAPI v0.2.0 / QA-029).
    for (var j = 0; j < _store.quotations.length; j++) {
      final other = _store.quotations[j];
      if (other.loadId == q.loadId &&
          other.id != q.id &&
          other.status == QuotationStatus.submitted) {
        _store.quotations[j] = Quotation(
          id: other.id,
          loadId: other.loadId,
          transporterCompanyId: other.transporterCompanyId,
          truckId: other.truckId,
          amount: other.amount,
          status: QuotationStatus.notSelected,
          notes: other.notes,
          validUntil: other.validUntil,
          createdAt: other.createdAt,
          updatedAt: now,
          transporterLegalName: other.transporterLegalName,
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

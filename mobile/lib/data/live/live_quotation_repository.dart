import '../../models/booking.dart';
import '../../models/quotation.dart';
import '../repositories/quotation_repository.dart';
import 'api_client.dart';
import 'live_json.dart';
import 'live_repositories.dart';

/// OpenAPI v0.5.0 quotations over HTTP.
///
/// Shipper reads: list, get, accept, restore-not-selected.
/// Transporter writes: create, withdraw, payout-preview.
/// Payout and commission figures exist only on [PayoutPreview], which the
/// shipper UI never requests.
class LiveQuotationRepository implements QuotationRepository {
  LiveQuotationRepository(this.api, {this.maxPages = 5});

  final ApiClient api;
  final int maxPages;

  Map<String, String> _idempotency() =>
      {'Idempotency-Key': newIdempotencyKey()};

  @override
  Future<List<Quotation>> forLoad(String loadId) async {
    final out = <Quotation>[];
    final path = '/loads/${Uri.encodeComponent(loadId)}/quotations';
    for (var page = 1; page <= maxPages; page++) {
      final j = await api.get(path, query: {
        'page': '$page',
        'pageSize': '100',
      }) as Map<String, dynamic>;
      out.addAll(quotationListFromJson(j));
      final totalPages = ((j['meta'] as Map)['totalPages'] as num).toInt();
      if (page >= totalPages) break;
    }
    return out;
  }

  @override
  Future<Quotation> getById(String quotationId) async {
    final j = await api
            .get('/quotations/${Uri.encodeComponent(quotationId)}')
        as Map<String, dynamic>;
    return quotationFromJson(j);
  }

  @override
  Future<Quotation> submit(
      String loadId, CreateQuotationRequest request) async {
    final j = await api.post(
      '/loads/${Uri.encodeComponent(loadId)}/quotations',
      body: createQuotationToJson(request),
      headers: _idempotency(),
    ) as Map<String, dynamic>;
    return quotationFromJson(j);
  }

  @override
  Future<Quotation> withdraw(String quotationId) async {
    final j = await api.post(
      '/quotations/${Uri.encodeComponent(quotationId)}/withdraw',
      headers: _idempotency(),
    ) as Map<String, dynamic>;
    return quotationFromJson(j);
  }

  @override
  Future<AcceptQuotationResponse> accept(String quotationId,
      {String? notes}) async {
    final trimmed = notes?.trim();
    final j = await api.post(
      '/quotations/${Uri.encodeComponent(quotationId)}/accept',
      body: {
        if (trimmed != null && trimmed.isNotEmpty) 'notes': trimmed,
      },
      headers: _idempotency(),
    ) as Map<String, dynamic>;
    return acceptQuotationFromJson(j);
  }

  @override
  Future<List<Quotation>> restoreNotSelected(String loadId,
      {String? reason}) async {
    final trimmed = reason?.trim();
    final j = await api.post(
      '/loads/${Uri.encodeComponent(loadId)}/quotations/restore-not-selected',
      body: {
        if (trimmed != null && trimmed.isNotEmpty) 'reason': trimmed,
      },
      headers: _idempotency(),
    ) as Map<String, dynamic>;
    return quotationListFromJson(j);
  }

  @override
  Future<PayoutPreview> previewPayout(PayoutPreviewRequest request) async {
    final j = await api.post(
      '/quotations/payout-preview',
      body: payoutPreviewToJson(request),
    ) as Map<String, dynamic>;
    return payoutPreviewFromJson(j);
  }
}

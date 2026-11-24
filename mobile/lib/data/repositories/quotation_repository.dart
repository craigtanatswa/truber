import '../../models/booking.dart';
import '../../models/quotation.dart';

/// OpenAPI v0.5.0 quotation operations.
abstract class QuotationRepository {
  /// `GET /loads/{loadId}/quotations`. Shippers see every quote on the load;
  /// transporters see only their own (the server filters).
  Future<List<Quotation>> forLoad(String loadId);

  /// `GET /quotations/{quotationId}`.
  Future<Quotation> getById(String quotationId);

  /// `POST /loads/{loadId}/quotations`.
  Future<Quotation> submit(String loadId, CreateQuotationRequest request);

  /// `POST /quotations/{quotationId}/withdraw`.
  Future<Quotation> withdraw(String quotationId);

  /// `POST /quotations/{quotationId}/accept`.
  Future<AcceptQuotationResponse> accept(String quotationId, {String? notes});

  /// `POST /loads/{loadId}/quotations/restore-not-selected`.
  Future<List<Quotation>> restoreNotSelected(String loadId, {String? reason});

  /// `POST /quotations/payout-preview`. Transporter-only. No side effects.
  Future<PayoutPreview> previewPayout(PayoutPreviewRequest request);
}

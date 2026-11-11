import '../../models/booking.dart';
import '../../models/quotation.dart';

abstract class QuotationRepository {
  Future<List<Quotation>> forLoad(String loadId);
  Future<Quotation> submit(String loadId, CreateQuotationRequest request);
  Future<AcceptQuotationResponse> accept(String quotationId, {String? notes});
}

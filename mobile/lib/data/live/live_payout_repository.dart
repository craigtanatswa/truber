import '../../models/money.dart';
import '../../models/payout.dart';
import '../repositories/payout_repository.dart';

/// OpenAPI v0.4.0 exposes PaymentReleaseRecord only as the 201 response of the
/// admin-only `POST /payment-arrangements/{id}/release`; there is no GET for a
/// transporter, and no quote net preview. Live mode therefore shows no payout
/// line (hidden, never computed on the client).
class LivePayoutRepository implements PayoutRepository {
  @override
  Future<List<TransporterPayout>> forTransporterCompany(
          String companyId) async =>
      const [];

  @override
  Future<MoneyAmount?> quoteNetPreview(
          String loadId, MoneyAmount amount) async =>
      null;
}

import '../../models/money.dart';
import '../../models/payout.dart';

abstract class PayoutRepository {
  /// Payouts for the transporter's bookings. Empty when the API offers none.
  Future<List<TransporterPayout>> forTransporterCompany(String companyId);

  /// Server-computed net for a proposed quote amount, or null when the API
  /// has no such field (OpenAPI v0.4.0 has none — the hint is then hidden).
  Future<MoneyAmount?> quoteNetPreview(String loadId, MoneyAmount amount);
}

import '../../models/booking.dart';
import '../../models/money.dart';
import '../../models/payment.dart';
import '../../models/payout.dart';
import '../repositories/payout_repository.dart';
import 'mock_seed.dart';

/// Mock stand-in for the server. Example values are PaymentReleaseRecord-shaped
/// (tripAmount − commissionAmount − processingFeesTotal = transporterNetAmount).
class MockPayoutRepository implements PayoutRepository {
  @override
  Future<List<TransporterPayout>> forTransporterCompany(
      String companyId) async {
    if (companyId != MockIds.transporterCompany) return const [];
    return seedTransporterPayouts();
  }

  /// Plays the server's role (spec: commission is server-computed, half-up
  /// 5% via `commissionRateBps`). Fees are unknown at quote time, so none.
  @override
  Future<MoneyAmount?> quoteNetPreview(
      String loadId, MoneyAmount amount) async {
    const bps = seedCommissionRateBps;
    final commission = (amount.amountMinor * bps + 5000) ~/ 10000;
    return MoneyAmount(
      amountMinor: amount.amountMinor - commission,
      currency: amount.currency,
    );
  }
}

/// OpenAPI PaymentReleaseRecord.commissionRateBps enum value.
const seedCommissionRateBps = 500;

List<TransporterPayout> seedTransporterPayouts() => const [
      // Released: release record exists (Payout approved + net).
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444441',
        routeLabel: 'Harare → Bulawayo',
        method: PaymentMethod.escrow,
        protectionStatus: ProtectionStatus.releasedFromProtection,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.releasedRecorded,
        bookingCommissionRateBps: seedCommissionRateBps,
        release: PaymentReleaseRecord(
          id: '55555555-5555-4555-8555-555555555551',
          arrangementId: '66666666-6666-4666-8666-666666666661',
          tripAmount: MoneyAmount(amountMinor: 95000, currency: 'USD'),
          commissionAmount: MoneyAmount(amountMinor: 4750, currency: 'USD'),
          commissionRateBps: seedCommissionRateBps,
          processingFeesTotal: MoneyAmount(amountMinor: 1250, currency: 'USD'),
          transporterNetAmount:
              MoneyAmount(amountMinor: 89000, currency: 'USD'),
        ),
      ),
      // Completed, release requested: no release record yet (no amounts).
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444442',
        routeLabel: 'Mutare → Harare',
        method: PaymentMethod.escrow,
        protectionStatus: ProtectionStatus.protected,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.releaseRequested,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
      // Completed, release failed: Design error-toned status line.
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444447',
        routeLabel: 'Masvingo → Beitbridge',
        method: PaymentMethod.escrow,
        protectionStatus: ProtectionStatus.protected,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.releaseFailed,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444443',
        routeLabel: 'Bindura → Chinhoyi',
        method: PaymentMethod.escrow,
        protectionStatus: ProtectionStatus.protected,
        completionStatus: CompletionStatus.awaitingShipperAcceptance,
        releaseStatus: ReleaseStatus.held,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444444',
        routeLabel: 'Chegutu → Kadoma',
        method: PaymentMethod.prepay,
        protectionStatus: ProtectionStatus.none,
        completionStatus: CompletionStatus.disputed,
        releaseStatus: ReleaseStatus.held,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444445',
        routeLabel: 'Kwekwe → Harare',
        method: PaymentMethod.corporateCredit,
        protectionStatus: ProtectionStatus.none,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.notApplicable,
        shipperPaymentRecorded: false,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
      // Cash: spec books no fare payout due, so no release record or status.
      TransporterPayout(
        bookingId: '44444444-4444-4444-8444-444444444446',
        routeLabel: 'Gweru → Masvingo',
        method: PaymentMethod.cash,
        protectionStatus: ProtectionStatus.none,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.notApplicable,
        bookingCommissionRateBps: seedCommissionRateBps,
      ),
    ];

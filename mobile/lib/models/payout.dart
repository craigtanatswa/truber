import 'booking.dart';
import 'money.dart';
import 'payment.dart';

/// OpenAPI v0.4.0 `PaymentReleaseRecord` (fields used by the transporter view).
/// All amounts are server-computed; the app never derives them.
class PaymentReleaseRecord {
  const PaymentReleaseRecord({
    required this.id,
    required this.arrangementId,
    required this.tripAmount,
    required this.commissionAmount,
    required this.transporterNetAmount,
    this.commissionRateBps,
    this.processingFeesTotal,
  });

  final String id;
  final String arrangementId;
  final MoneyAmount tripAmount;
  final MoneyAmount commissionAmount;

  /// Optional in the spec (`enum: [500]`).
  final int? commissionRateBps;

  /// Nullable in the spec; zero allowed.
  final MoneyAmount? processingFeesTotal;
  final MoneyAmount transporterNetAmount;
}

/// What the transporter sees for one booking: arrangement method/protection
/// (OpenAPI PaymentArrangement) plus the release record when one exists.
class TransporterPayout {
  const TransporterPayout({
    required this.bookingId,
    required this.routeLabel,
    required this.method,
    required this.protectionStatus,
    required this.completionStatus,
    required this.releaseStatus,
    this.release,
    this.bookingCommissionRateBps,
    this.shipperPaymentRecorded,
  });

  final String bookingId;

  /// From the booking's Load (pickupAddress → destinationAddress).
  final String routeLabel;
  final PaymentMethod method;
  final ProtectionStatus protectionStatus;
  final PaymentReleaseRecord? release;

  /// OpenAPI Booking.completionStatus (delivery acceptance / dispute).
  final CompletionStatus completionStatus;

  /// OpenAPI PaymentArrangement.releaseStatus.
  final ReleaseStatus releaseStatus;

  /// Corporate credit only: true once a PaymentTransaction for the shipper's
  /// payment has paymentStatus `paid` (spec: payout blocked until recorded).
  final bool? shipperPaymentRecorded;

  /// OpenAPI Booking.commissionRateBps, used when the release omits it.
  final int? bookingCommissionRateBps;

  int? get commissionRateBps =>
      release?.commissionRateBps ?? bookingCommissionRateBps;

  /// Payout line shows only when every displayed field came from the API.
  bool get hasNetPayout => release != null && commissionRateBps != null;

  PayoutStatus? get status => payoutStatusFor(this);

  bool get isCash => method == PaymentMethod.cash;

  /// Protected helper only for server-accepted protection (never cash).
  bool get isProtected =>
      !isCash &&
      (protectionStatus == ProtectionStatus.protected ||
          protectionStatus == ProtectionStatus.releasedFromProtection);
}

/// Formats a basis-point rate from the API as a percentage label: 500 → "5",
/// 250 → "2.5". Formatting only; no amounts are derived.
String formatBpsAsPercent(int bps) {
  if (bps % 100 == 0) return '${bps ~/ 100}';
  final s = (bps / 100).toStringAsFixed(2);
  return s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

enum PayoutStatus {
  awaitingDelivery,
  awaitingRelease,
  onHoldDispute,
  awaitingShipperPayment,
  released,
  releaseFailed,
}

/// Maps spec state to a Design payout status line (never "paid"/"sent").
/// Null when no line applies: cash (no fare payout due), cancelled trips,
/// `release_failed` shows Design's `payout.status_release_failed`.
PayoutStatus? payoutStatusFor(TransporterPayout p) {
  if (p.isCash) return null;
  if (p.completionStatus == CompletionStatus.cancelled) return null;
  if (p.releaseStatus == ReleaseStatus.releaseFailed) {
    return PayoutStatus.releaseFailed;
  }
  if (p.releaseStatus == ReleaseStatus.releasedRecorded || p.release != null) {
    return PayoutStatus.released;
  }
  switch (p.completionStatus) {
    case CompletionStatus.disputed:
      return PayoutStatus.onHoldDispute;
    case CompletionStatus.notComplete:
    case CompletionStatus.awaitingShipperAcceptance:
      return PayoutStatus.awaitingDelivery;
    case CompletionStatus.completed:
      if (p.method == PaymentMethod.corporateCredit &&
          p.shipperPaymentRecorded != true) {
        return PayoutStatus.awaitingShipperPayment;
      }
      return PayoutStatus.awaitingRelease;
    case CompletionStatus.cancelled:
      return null;
  }
}

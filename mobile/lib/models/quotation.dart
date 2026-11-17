import 'money.dart';

/// OpenAPI v0.5.0: Quotation, QuotationStatus, CreateQuotationRequest.
enum QuotationStatus {
  submitted,
  withdrawn,
  accepted,
  notSelected,
  rejected,
  expired,
}

class Quotation {
  const Quotation({
    required this.id,
    required this.loadId,
    required this.transporterCompanyId,
    required this.amount,
    required this.status,
    required this.validUntil,
    required this.createdAt,
    required this.updatedAt,
    this.truckId,
    this.notes,

    /// Display helper — not on OpenAPI Quotation; joined from Company in mock.
    this.transporterLegalName,

    /// OpenAPI v0.5.0. Latest active ban `endsAt` on the caller's counterparty,
    /// or null. Date only: no reason. Shippers use it to block accept.
    this.counterpartyRestrictedUntil,
  });

  final String id;
  final String loadId;
  final String transporterCompanyId;
  final String? truckId;
  final MoneyAmount amount;
  final QuotationStatus status;
  final String? notes;
  final DateTime validUntil;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? transporterLegalName;
  final DateTime? counterpartyRestrictedUntil;

  bool counterpartyRestrictedAt(DateTime now) {
    final until = counterpartyRestrictedUntil;
    return until != null && now.isBefore(until);
  }

  Quotation copyWith({
    QuotationStatus? status,
    String? notes,
    DateTime? updatedAt,
    DateTime? counterpartyRestrictedUntil,
  }) {
    return Quotation(
      id: id,
      loadId: loadId,
      transporterCompanyId: transporterCompanyId,
      truckId: truckId,
      amount: amount,
      status: status ?? this.status,
      notes: notes ?? this.notes,
      validUntil: validUntil,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      transporterLegalName: transporterLegalName,
      counterpartyRestrictedUntil:
          counterpartyRestrictedUntil ?? this.counterpartyRestrictedUntil,
    );
  }
}

class CreateQuotationRequest {
  const CreateQuotationRequest({
    required this.transporterCompanyId,
    required this.amount,
    required this.validUntil,
    this.truckId,
    this.notes,
  });

  final String transporterCompanyId;
  final String? truckId;
  final MoneyAmount amount;
  final String? notes;
  final DateTime validUntil;
}

/// OpenAPI v0.5.0 `PayoutPreviewRequest`. Side-effect free.
class PayoutPreviewRequest {
  const PayoutPreviewRequest({
    required this.transporterCompanyId,
    required this.amount,
    this.loadId,
    this.paymentMethod,
  });

  final String transporterCompanyId;
  final MoneyAmount amount;
  final String? loadId;

  /// OpenAPI PaymentMethod value, or null when the quote has no method yet.
  final String? paymentMethod;
}

/// One `submissionBlockers` entry. Outstanding amounts are intentionally not
/// stored: the quote screen must not render a commission breakdown.
class SubmissionBlocker {
  const SubmissionBlocker({required this.code, this.bannedUntil});

  /// `ACCOUNT_BANNED` or `COMMISSION_OUTSTANDING`.
  final String code;
  final DateTime? bannedUntil;
}

/// OpenAPI v0.5.0 `PayoutPreview`. Figures are server-computed.
/// Transporter UI may show [netPayoutBeforeUnknownFees] only.
/// Shipper UI must not receive this object.
class PayoutPreview {
  const PayoutPreview({
    required this.agreedAmount,
    required this.commissionRateBps,
    required this.commissionAmount,
    required this.knownFeesTotal,
    required this.netPayoutBeforeUnknownFees,
    required this.feeStatus,
    required this.farePayoutDueThroughTruber,
    required this.paymentProtectedPossible,
    required this.submissionBlockers,
    this.paymentMethod,
  });

  final MoneyAmount agreedAmount;
  final int commissionRateBps;
  final MoneyAmount commissionAmount;
  final MoneyAmount knownFeesTotal;
  final MoneyAmount netPayoutBeforeUnknownFees;

  /// `unknown`, `known`, or `not_applicable`.
  final String feeStatus;
  final String? paymentMethod;
  final bool farePayoutDueThroughTruber;
  final bool paymentProtectedPossible;
  final List<SubmissionBlocker> submissionBlockers;
}

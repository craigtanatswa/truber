import 'money.dart';

/// Deposit/balance split (about half now; deposit = floor(total / 2)).
/// Contract (CreatePaymentArrangementRequest): depositAmount and balanceAmount
/// are each PositiveMoneyAmount (amountMinor >= 1) and must sum to total.
/// Returns null when either part would be below 1 minor unit (total < 2),
/// so the split must not be offered or sent.
({MoneyAmount deposit, MoneyAmount balance})? depositBalanceSplit(
  MoneyAmount total,
) {
  final deposit = total.amountMinor ~/ 2;
  final balance = total.amountMinor - deposit;
  if (deposit < 1 || balance < 1) return null;
  return (
    deposit: MoneyAmount(amountMinor: deposit, currency: total.currency),
    balance: MoneyAmount(amountMinor: balance, currency: total.currency),
  );
}

/// OpenAPI: PaymentMethod, ArrangementStatus, ProtectionStatus, ReleaseStatus,
/// PaymentArrangement, CreatePaymentArrangementRequest.
enum PaymentMethod {
  prepay,
  escrow,
  depositBalance,
  cash,
  corporateCredit,
}

enum ArrangementStatus { proposed, confirmed, rejected, cancelled }

enum ProtectionStatus {
  none,
  pendingEvidence,
  protected,
  protectionFailed,
  releasedFromProtection,
}

enum ReleaseStatus {
  notApplicable,
  held,
  releaseRequested,
  releasedRecorded,
  releaseFailed,
}

extension PaymentMethodApi on PaymentMethod {
  String get apiValue => switch (this) {
        PaymentMethod.depositBalance => 'deposit_balance',
        PaymentMethod.corporateCredit => 'corporate_credit',
        _ => name,
      };
}

class PaymentArrangement {
  const PaymentArrangement({
    required this.id,
    required this.bookingId,
    required this.method,
    required this.arrangementStatus,
    required this.protectionStatus,
    required this.releaseStatus,
    required this.totalAmount,
    required this.createdAt,
    required this.updatedAt,
    this.depositAmount,
    this.balanceAmount,
    this.corporateCreditTermsDays,
    this.providerHint,
    this.confirmedAt,
    this.confirmedByUserId,
  });

  final String id;
  final String bookingId;
  final PaymentMethod method;
  final ArrangementStatus arrangementStatus;
  final ProtectionStatus protectionStatus;
  final ReleaseStatus releaseStatus;
  final MoneyAmount totalAmount;
  final MoneyAmount? depositAmount;
  final MoneyAmount? balanceAmount;
  final int? corporateCreditTermsDays;
  final String? providerHint;
  final DateTime? confirmedAt;
  final String? confirmedByUserId;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isConfirmed => arrangementStatus == ArrangementStatus.confirmed;
  bool get isCash => method == PaymentMethod.cash;
  bool get isProtected =>
      protectionStatus == ProtectionStatus.protected ||
      (method != PaymentMethod.cash &&
          arrangementStatus == ArrangementStatus.confirmed &&
          protectionStatus != ProtectionStatus.none);

  PaymentArrangement copyWith({
    ArrangementStatus? arrangementStatus,
    ProtectionStatus? protectionStatus,
    ReleaseStatus? releaseStatus,
    DateTime? confirmedAt,
    String? confirmedByUserId,
    DateTime? updatedAt,
  }) {
    return PaymentArrangement(
      id: id,
      bookingId: bookingId,
      method: method,
      arrangementStatus: arrangementStatus ?? this.arrangementStatus,
      protectionStatus: protectionStatus ?? this.protectionStatus,
      releaseStatus: releaseStatus ?? this.releaseStatus,
      totalAmount: totalAmount,
      depositAmount: depositAmount,
      balanceAmount: balanceAmount,
      corporateCreditTermsDays: corporateCreditTermsDays,
      providerHint: providerHint,
      confirmedAt: confirmedAt ?? this.confirmedAt,
      confirmedByUserId: confirmedByUserId ?? this.confirmedByUserId,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

class CreatePaymentArrangementRequest {
  const CreatePaymentArrangementRequest({
    required this.method,
    required this.totalAmount,
    this.depositAmount,
    this.balanceAmount,
    this.corporateCreditTermsDays,
    this.providerHint,
    this.notes,
  });

  final PaymentMethod method;
  final MoneyAmount totalAmount;
  final MoneyAmount? depositAmount;
  final MoneyAmount? balanceAmount;
  final int? corporateCreditTermsDays;
  final String? providerHint;
  final String? notes;
}

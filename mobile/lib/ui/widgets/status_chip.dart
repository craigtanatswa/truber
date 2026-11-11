import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';
import '../../models/booking.dart';
import '../../models/load.dart';
import '../../models/payment.dart';
import '../../models/quotation.dart';
import '../../models/user.dart';

enum StatusChipTone { warning, info, success, grey, error, protected }

class StatusChipStyle {
  const StatusChipStyle(this.tone, this.fg, this.bg);
  final StatusChipTone tone;
  final Color fg;
  final Color bg;

  /// Cobalt restore + dark variants (MOBILE-SYNC-2026-11-07).
  static StatusChipStyle of(
    StatusChipTone tone, {
    Brightness brightness = Brightness.light,
  }) {
    final dark = brightness == Brightness.dark;
    return switch (tone) {
      StatusChipTone.warning => StatusChipStyle(
          StatusChipTone.warning,
          dark ? TruberColors.warningDark : TruberColors.warning,
          dark ? TruberColors.warningSoftDark : TruberColors.warningSoft,
        ),
      StatusChipTone.info => StatusChipStyle(
          StatusChipTone.info,
          dark ? TruberColors.primaryTextDark : TruberColors.info,
          dark ? TruberColors.infoSoftDark : TruberColors.infoSoft,
        ),
      StatusChipTone.protected => StatusChipStyle(
          StatusChipTone.protected,
          TruberColors.white,
          dark
              ? TruberColors.paymentProtectedDark
              : TruberColors.paymentProtected,
        ),
      StatusChipTone.success => StatusChipStyle(
          StatusChipTone.success,
          dark ? TruberColors.successDark : TruberColors.success,
          dark ? TruberColors.successSoftDark : TruberColors.successSoft,
        ),
      StatusChipTone.grey => StatusChipStyle(
          StatusChipTone.grey,
          dark ? TruberColors.textSecondaryDark : TruberColors.grey600,
          dark ? TruberColors.grey700 : TruberColors.grey100,
        ),
      StatusChipTone.error => StatusChipStyle(
          StatusChipTone.error,
          dark ? TruberColors.errorDark : TruberColors.error,
          dark ? TruberColors.errorSoftDark : TruberColors.errorSoft,
        ),
    };
  }
}

/// Design: pending/awaiting = warning; confirmed/in progress = info (cobalt);
/// delivered/completed = success (teal); cancelled = grey; disputed = error;
/// payment protected = black fill + white label + cobalt400 check (v3).
StatusChipTone bookingStatusTone(BookingStatus status) => switch (status) {
      BookingStatus.pendingPaymentArrangement => StatusChipTone.warning,
      BookingStatus.confirmed => StatusChipTone.info,
      BookingStatus.cancelled => StatusChipTone.grey,
    };

StatusChipTone tripStatusTone(TripStatus status) => switch (status) {
      TripStatus.notStarted => StatusChipTone.warning,
      TripStatus.truckDispatched => StatusChipTone.info,
      TripStatus.goodsCollected => StatusChipTone.info,
      TripStatus.inTransit => StatusChipTone.info,
      TripStatus.delivered => StatusChipTone.success,
    };

StatusChipTone completionStatusTone(CompletionStatus status) =>
    switch (status) {
      CompletionStatus.notComplete => StatusChipTone.warning,
      CompletionStatus.awaitingShipperAcceptance => StatusChipTone.warning,
      CompletionStatus.completed => StatusChipTone.success,
      CompletionStatus.disputed => StatusChipTone.error,
      CompletionStatus.cancelled => StatusChipTone.grey,
    };

String bookingStatusLabel(BookingStatus status) => switch (status) {
      BookingStatus.pendingPaymentArrangement =>
        TruberCopy.statusBookingPendingPaymentArrangement,
      BookingStatus.confirmed => TruberCopy.statusBookingConfirmed,
      BookingStatus.cancelled => TruberCopy.statusBookingCancelled,
    };

String tripStatusLabel(TripStatus status) => switch (status) {
      TripStatus.notStarted => TruberCopy.statusTripNotStarted,
      TripStatus.truckDispatched => TruberCopy.statusTripTruckDispatched,
      TripStatus.goodsCollected => TruberCopy.statusTripGoodsCollected,
      TripStatus.inTransit => TruberCopy.statusTripInTransit,
      TripStatus.delivered => TruberCopy.statusTripDelivered,
    };

String completionStatusLabel(CompletionStatus status, UserRole role) =>
    switch (status) {
      CompletionStatus.notComplete => TruberCopy.statusCompletionNotComplete,
      CompletionStatus.awaitingShipperAcceptance => role == UserRole.shipper
          ? TruberCopy.statusCompletionAwaitingShipperShipper
          : TruberCopy.statusCompletionAwaitingShipperTransporter,
      CompletionStatus.completed => TruberCopy.statusCompletionCompleted,
      CompletionStatus.disputed => TruberCopy.statusCompletionDisputed,
      CompletionStatus.cancelled => TruberCopy.statusCompletionCancelled,
    };

class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    required this.tone,
    this.borderColor,
    this.foregroundColor,
    this.backgroundColor,
  });

  final String label;
  final StatusChipTone tone;
  final Color? borderColor;
  final Color? foregroundColor;
  final Color? backgroundColor;

  factory StatusChip.booking(BookingStatus status, {Key? key}) => StatusChip(
        key: key,
        label: bookingStatusLabel(status),
        tone: bookingStatusTone(status),
      );

  factory StatusChip.trip(TripStatus status, {Key? key}) => StatusChip(
        key: key,
        label: tripStatusLabel(status),
        tone: tripStatusTone(status),
      );

  factory StatusChip.completion(
    CompletionStatus status,
    UserRole role, {
    Key? key,
  }) =>
      StatusChip(
        key: key,
        label: completionStatusLabel(status, role),
        tone: completionStatusTone(status),
      );

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final style = StatusChipStyle.of(tone, brightness: brightness);
    final fg = foregroundColor ?? style.fg;
    final border = borderColor ?? style.fg;
    final showCheck = tone == StatusChipTone.protected;
    // v3: cobalt400 check on black protected fill (brand cobalt fails AA on black).
    const checkColor = TruberColors.cobalt400;
    final effectiveBorder = showCheck && brightness == Brightness.dark
        ? TruberColors.borderDark
        : border;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TruberSpacing.sm,
        vertical: TruberSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: backgroundColor ?? style.bg,
        borderRadius: TruberRadii.borderFull,
        border: Border.all(color: effectiveBorder),
      ),
      child: showCheck
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: fg,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(width: TruberSpacing.xs),
                const Icon(
                  Icons.check_circle,
                  size: 14,
                  color: checkColor,
                ),
              ],
            )
          : Text(
              label,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: fg,
                    fontWeight: FontWeight.w600,
                  ),
            ),
    );
  }
}

StatusChipTone loadStatusTone(LoadStatus status) => switch (status) {
      LoadStatus.draft => StatusChipTone.grey,
      LoadStatus.posted => StatusChipTone.info,
      LoadStatus.quoting => StatusChipTone.info,
      LoadStatus.bookingPending => StatusChipTone.warning,
      LoadStatus.booked => StatusChipTone.info,
      LoadStatus.inProgress => StatusChipTone.info,
      LoadStatus.awaitingShipperAcceptance => StatusChipTone.warning,
      LoadStatus.completed => StatusChipTone.success,
      LoadStatus.cancelled => StatusChipTone.grey,
    };

String loadStatusLabel(LoadStatus status, UserRole role) => switch (status) {
      LoadStatus.draft => TruberCopy.statusLoadDraft,
      LoadStatus.posted => TruberCopy.statusLoadPosted,
      LoadStatus.quoting => TruberCopy.statusLoadQuoting,
      LoadStatus.bookingPending => TruberCopy.statusLoadBookingPending,
      LoadStatus.booked => TruberCopy.statusLoadBooked,
      LoadStatus.inProgress => TruberCopy.statusLoadInProgress,
      LoadStatus.awaitingShipperAcceptance => role == UserRole.shipper
          ? TruberCopy.statusLoadAwaitingShipperShipper
          : TruberCopy.statusLoadAwaitingShipperTransporter,
      LoadStatus.completed => TruberCopy.statusLoadCompleted,
      LoadStatus.cancelled => TruberCopy.statusLoadCancelled,
    };

class LoadStatusChip extends StatelessWidget {
  const LoadStatusChip({
    super.key,
    required this.status,
    required this.role,
  });

  final LoadStatus status;
  final UserRole role;

  @override
  Widget build(BuildContext context) {
    return StatusChip(
      label: loadStatusLabel(status, role),
      tone: loadStatusTone(status),
    );
  }
}

String arrangementStatusLabel(ArrangementStatus status) => switch (status) {
      ArrangementStatus.proposed => TruberCopy.statusArrangementProposed,
      ArrangementStatus.confirmed => TruberCopy.statusArrangementConfirmed,
      ArrangementStatus.rejected => TruberCopy.statusArrangementRejected,
      ArrangementStatus.cancelled => TruberCopy.statusArrangementCancelled,
    };

String protectionStatusLabel(ProtectionStatus status) => switch (status) {
      ProtectionStatus.none => TruberCopy.statusProtectionNone,
      ProtectionStatus.pendingEvidence =>
        TruberCopy.statusProtectionPendingEvidence,
      ProtectionStatus.protected => TruberCopy.statusProtectionProtected,
      ProtectionStatus.protectionFailed => TruberCopy.statusProtectionFailed,
      ProtectionStatus.releasedFromProtection =>
        TruberCopy.statusProtectionReleased,
    };

StatusChipTone arrangementStatusTone(ArrangementStatus status) =>
    switch (status) {
      ArrangementStatus.proposed => StatusChipTone.warning,
      ArrangementStatus.confirmed => StatusChipTone.info,
      ArrangementStatus.rejected => StatusChipTone.error,
      ArrangementStatus.cancelled => StatusChipTone.grey,
    };

StatusChipTone protectionStatusTone(ProtectionStatus status) =>
    switch (status) {
      ProtectionStatus.none => StatusChipTone.grey,
      ProtectionStatus.pendingEvidence => StatusChipTone.warning,
      ProtectionStatus.protected => StatusChipTone.protected,
      ProtectionStatus.protectionFailed => StatusChipTone.error,
      ProtectionStatus.releasedFromProtection => StatusChipTone.success,
    };

bool protectionUsesCashBorder(ProtectionStatus status) =>
    status == ProtectionStatus.none;

String paymentMethodLabel(PaymentMethod method) => switch (method) {
      PaymentMethod.prepay => TruberCopy.payPrepay,
      PaymentMethod.escrow => TruberCopy.payProtected,
      PaymentMethod.depositBalance => TruberCopy.payDepositBalance,
      PaymentMethod.cash => TruberCopy.payCash,
      PaymentMethod.corporateCredit => TruberCopy.payCorporateCredit,
    };

StatusChipTone quotationStatusTone(QuotationStatus status) => switch (status) {
      QuotationStatus.submitted => StatusChipTone.warning,
      QuotationStatus.withdrawn => StatusChipTone.grey,
      QuotationStatus.accepted => StatusChipTone.success,
      QuotationStatus.notSelected => StatusChipTone.grey,
      QuotationStatus.rejected => StatusChipTone.error,
      QuotationStatus.expired => StatusChipTone.grey,
    };

String quotationStatusLabel(QuotationStatus status) => switch (status) {
      QuotationStatus.submitted => TruberCopy.statusQuotationSubmitted,
      QuotationStatus.withdrawn => TruberCopy.statusQuotationWithdrawn,
      QuotationStatus.accepted => TruberCopy.statusQuotationAccepted,
      QuotationStatus.notSelected => TruberCopy.statusQuotationNotSelected,
      QuotationStatus.rejected => TruberCopy.statusQuotationRejected,
      QuotationStatus.expired => TruberCopy.statusQuotationExpired,
    };

import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';

/// Design v3: paymentProtected — black fill + white label + cobalt400 check.
class ProtectedPaymentBadge extends StatelessWidget {
  const ProtectedPaymentBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fill = dark
        ? TruberColors.paymentProtectedDark
        : TruberColors.paymentProtected;
    // cobalt400 on black ≈ 5.50:1 AA (brand cobalt600 fails on black).
    const check = TruberColors.cobalt400;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TruberSpacing.sm,
        vertical: TruberSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: TruberRadii.borderFull,
        border: dark ? Border.all(color: TruberColors.borderDark) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            TruberCopy.payProtectedBadge,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: TruberColors.white,
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(width: TruberSpacing.xs),
          const Icon(
            Icons.check_circle,
            size: 14,
            color: check,
          ),
        ],
      ),
    );
  }
}

class CashWarningBadge extends StatelessWidget {
  const CashWarningBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      key: const Key('cash_warning_badge'),
      padding: const EdgeInsets.symmetric(
        horizontal: TruberSpacing.sm,
        vertical: TruberSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: dark
            ? TruberColors.paymentCashSoftDark
            : TruberColors.paymentCashSoft,
        borderRadius: TruberRadii.borderFull,
        border: Border.all(
          color: dark
              ? TruberColors.paymentCashBorderDark
              : TruberColors.paymentCashBorder,
        ),
      ),
      child: Text(
        TruberCopy.payCashBadge,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: dark ? TruberColors.warningDark : TruberColors.warning,
            ),
      ),
    );
  }
}

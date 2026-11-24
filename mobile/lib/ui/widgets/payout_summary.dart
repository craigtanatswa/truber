import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';
import '../../models/money.dart';
import '../../models/payout.dart';

String _value(MoneyAmount m) => TruberCopy.payoutNetValueFor(m.display);
String _deduction(MoneyAmount m) => TruberCopy.payoutDeductionFor(m.display);

String payoutStatusLabel(PayoutStatus s) => switch (s) {
      PayoutStatus.awaitingDelivery => TruberCopy.payoutStatusAwaitingDelivery,
      PayoutStatus.awaitingRelease => TruberCopy.payoutStatusAwaitingRelease,
      PayoutStatus.onHoldDispute => TruberCopy.payoutStatusOnHoldDispute,
      PayoutStatus.awaitingShipperPayment =>
        TruberCopy.payoutStatusAwaitingShipperPayment,
      PayoutStatus.released => TruberCopy.payoutStatusReleased,
      PayoutStatus.releaseFailed => TruberCopy.payoutStatusReleaseFailed,
    };

/// Transporter net payout (Design `payout.*`). Every figure is read from the
/// API's PaymentReleaseRecord; nothing is computed here. When the record or
/// rate is missing, the payout line is hidden and only the helper remains.
class PayoutSummary extends StatefulWidget {
  const PayoutSummary(
      {super.key, required this.payout, this.initiallyExpanded = false});

  final TransporterPayout payout;
  final bool initiallyExpanded;

  @override
  State<PayoutSummary> createState() => _PayoutSummaryState();
}

class _PayoutSummaryState extends State<PayoutSummary> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final p = widget.payout;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final release = p.release;
    final helper = p.isCash
        ? TruberCopy.payoutHelperCash
        : p.isProtected
            ? TruberCopy.payoutHelperProtected
            : null;

    final children = <Widget>[];
    final status = p.status;
    if (status == PayoutStatus.releaseFailed) {
      // Design: release_failed uses the error tokens.
      final dark = theme.brightness == Brightness.dark;
      final fg = dark ? TruberColors.errorDark : TruberColors.error;
      children.add(Container(
        key: const Key('payout_status_failed'),
        padding: const EdgeInsets.all(TruberSpacing.sm),
        decoration: BoxDecoration(
          color: dark ? TruberColors.errorSoftDark : TruberColors.errorSoft,
          borderRadius: TruberRadii.borderMd,
          border: Border.all(color: fg),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, size: 20, color: fg),
            const SizedBox(width: TruberSpacing.sm),
            Expanded(
              child: Text(
                payoutStatusLabel(status!),
                key: const Key('payout_status'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: fg,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ));
      children.add(const SizedBox(height: TruberSpacing.sm));
    } else if (status != null) {
      children.add(Text(
        payoutStatusLabel(status),
        key: const Key('payout_status'),
        style: theme.textTheme.bodyMedium?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w600,
        ),
      ));
      children.add(const SizedBox(height: TruberSpacing.sm));
    }
    if (p.hasNetPayout && release != null) {
      final bold = theme.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w700,
        color: scheme.onSurface,
      );
      children.add(Row(
        key: const Key('payout_net_line'),
        children: [
          Expanded(child: Text(TruberCopy.payoutNetLabel, style: bold)),
          Text(_value(release.transporterNetAmount), style: bold),
        ],
      ));
      children.add(Align(
        alignment: AlignmentDirectional.centerStart,
        child: TextButton.icon(
          key: const Key('payout_breakdown_toggle'),
          style: TextButton.styleFrom(padding: EdgeInsets.zero),
          onPressed: () => setState(() => _expanded = !_expanded),
          icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
          label: const Text(TruberCopy.payoutBreakdownToggle),
        ),
      ));
      if (_expanded) {
        final fees = release.processingFeesTotal;
        children.add(Column(
          key: const Key('payout_breakdown'),
          children: [
            _Row(TruberCopy.payoutAgreedPrice, _value(release.tripAmount)),
            _Row(
              TruberCopy.payoutCommissionFor(
                  formatBpsAsPercent(p.commissionRateBps!)),
              _deduction(release.commissionAmount),
            ),
            if (fees != null && fees.amountMinor != 0)
              _Row(TruberCopy.payoutFees, _deduction(fees),
                  key: const Key('payout_fees_row')),
            const Divider(),
            _Row(
                TruberCopy.payoutNetTotal, _value(release.transporterNetAmount),
                bold: true),
          ],
        ));
      }
    }
    if (helper != null) {
      if (children.isNotEmpty) {
        children.add(const SizedBox(height: TruberSpacing.sm));
      }
      children.add(Text(
        helper,
        key: const Key('payout_helper'),
        style: theme.textTheme.bodyMedium
            ?.copyWith(color: scheme.onSurfaceVariant),
      ));
    }
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {super.key, this.bold = false});
  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = theme.textTheme.bodyLarge?.copyWith(
      color: theme.colorScheme.onSurface,
      fontWeight: bold ? FontWeight.w700 : null,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TruberSpacing.xs),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}

/// Card for one booking on the transporter home: route + payout summary.
class PayoutCard extends StatelessWidget {
  const PayoutCard({super.key, required this.payout, this.onTap});
  final TransporterPayout payout;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(TruberSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(payout.routeLabel,
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: TruberSpacing.sm),
              PayoutSummary(payout: payout),
            ],
          ),
        ),
      ),
    );
  }
}

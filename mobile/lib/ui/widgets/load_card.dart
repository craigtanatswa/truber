import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';
import '../format/dates.dart';

import '../../models/load.dart';

class LoadCard extends StatelessWidget {
  const LoadCard({
    super.key,
    required this.load,
    this.onTap,
    this.trailing,
  });

  final FreightLoad load;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: TruberRadii.borderMd,
        child: Padding(
          padding: const EdgeInsets.all(TruberSpacing.cardPadding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      load.routeLabel,
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
              const SizedBox(height: TruberSpacing.sm),
              Text(
                '${load.goodsType} · ${load.weightTonnes.toStringAsFixed(0)} t · ${load.truckTypeRequired.label}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: TruberSpacing.xs),
              Text(
                TruberCopy.loadSchedule(
                  loadingDate: formatDisplayDate(load.loadingDate),
                  deadline: load.deliveryDeadline == null
                      ? null
                      : formatDisplayDate(load.deliveryDeadline!),
                ),
                style: theme.textTheme.bodySmall,
              ),
              if (load.offeredRate != null) ...[
                const SizedBox(height: TruberSpacing.sm),
                Text(
                  load.rateType == RateType.negotiable
                      ? '${load.offeredRate!.display} · ${TruberCopy.loadRateNegotiable}'
                      : load.offeredRate!.display,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

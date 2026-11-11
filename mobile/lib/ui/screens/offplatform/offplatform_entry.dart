import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/offplatform.dart';
import '../../../state/session.dart';
import '../../navigation/truber_page_route.dart';
import '../../widgets/status_chip.dart';
import 'offplatform_report_screen.dart';

String reportStatusLabel(OffPlatformReportStatus s) => switch (s) {
      OffPlatformReportStatus.open => TruberCopy.offplatformStatusOpen,
      OffPlatformReportStatus.confirmed =>
        TruberCopy.offplatformStatusConfirmed,
      OffPlatformReportStatus.notConfirmed =>
        TruberCopy.offplatformStatusNotConfirmed,
    };

/// Design chip tokens for report status. Never success or green.
({Color fg, Color bg}) reportChipColors(
  OffPlatformReportStatus s,
  Brightness brightness,
) {
  final dark = brightness == Brightness.dark;
  return switch (s) {
    OffPlatformReportStatus.open => (
        fg: dark ? TruberColors.warningDark : TruberColors.warning,
        bg: dark ? TruberColors.warningSoftDark : TruberColors.warningSoft,
      ),
    OffPlatformReportStatus.confirmed => (
        fg: dark ? TruberColors.errorDark : TruberColors.error,
        bg: dark ? TruberColors.errorSoftDark : TruberColors.errorSoft,
      ),
    OffPlatformReportStatus.notConfirmed => (
        fg: dark ? TruberColors.textSecondaryDark : TruberColors.textSecondary,
        bg: dark ? TruberColors.surfaceMutedDark : TruberColors.surfaceSunken,
      ),
  };
}

class ReportStatusChip extends StatelessWidget {
  const ReportStatusChip({super.key, required this.status});
  final OffPlatformReportStatus status;
  @override
  Widget build(BuildContext context) {
    final c = reportChipColors(status, Theme.of(context).brightness);
    return StatusChip(
      label: reportStatusLabel(status),
      tone: StatusChipTone.grey,
      foregroundColor: c.fg,
      backgroundColor: c.bg,
      borderColor: c.fg,
    );
  }
}

/// Booking-detail block: nudge, status of reports already filed, and the
/// "Report dealing outside Truber" entry. Hidden when no report repository.
class OffPlatformEntry extends StatefulWidget {
  const OffPlatformEntry({
    super.key,
    required this.bookingId,
  });
  final String bookingId;

  @override
  State<OffPlatformEntry> createState() => _OffPlatformEntryState();
}

class _OffPlatformEntryState extends State<OffPlatformEntry> {
  Future<List<OffPlatformReport>>? _reports;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final repo = context.read<SessionController>().reports;
    _reports = repo?.forBooking(widget.bookingId);
  }

  Future<void> _open() async {
    await Navigator.of(context).push(TruberPageRoute<void>.of(
      context,
      builder: (_) => OffPlatformReportScreen(bookingId: widget.bookingId),
    ));
    if (!mounted) return;
    setState(_load);
  }

  @override
  Widget build(BuildContext context) {
    if (context.read<SessionController>().reports == null) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    return Column(
      key: const Key('offplatform_entry_block'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          TruberCopy.offplatformNudge,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        FutureBuilder<List<OffPlatformReport>>(
          future: _reports,
          builder: (context, snap) {
            final list = snap.data ?? const <OffPlatformReport>[];
            if (list.isEmpty) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(top: TruberSpacing.sm),
              child: Wrap(
                spacing: TruberSpacing.sm,
                runSpacing: TruberSpacing.xs,
                children: [
                  for (final r in list)
                    ReportStatusChip(
                        key: Key('report_status_${r.id}'), status: r.status),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: TruberSpacing.sm),
        OutlinedButton(
          key: const Key('offplatform_entry'),
          onPressed: _open,
          child: const Text(TruberCopy.offplatformEntry),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../errors/error_messages.dart';
import '../../../models/load.dart';
import '../../../models/quotation.dart';
import '../../../state/session.dart';
import '../../widgets/ban_banner.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/load_card.dart';
import '../../widgets/status_chip.dart';
import 'booking_confirm_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

class QuotationsScreen extends StatefulWidget {
  const QuotationsScreen({super.key, required this.load});

  final FreightLoad load;

  @override
  State<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends State<QuotationsScreen> {
  Future<List<Quotation>>? _future;
  bool _busy = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _future =
          context.read<SessionController>().quotations.forLoad(widget.load.id);
    }
  }

  final Map<String, Future<bool?>> _counterpartyBan = {};

  Future<bool?> _isBanned(String companyId) => _counterpartyBan.putIfAbsent(
      companyId,
      () => context.read<SessionController>().isCompanyBanned(companyId));

  void _reload() {
    setState(() {
      _future =
          context.read<SessionController>().quotations.forLoad(widget.load.id);
    });
  }

  Future<void> _restore() async {
    if (blockIfBanned(context)) return;
    setState(() => _busy = true);
    try {
      await context
          .read<SessionController>()
          .quotations
          .restoreNotSelected(widget.load.id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(TruberCopy.quoteRestored)),
    );
    _reload();
  }

  Future<void> _select(Quotation quote) async {
    if (blockIfBanned(context)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('accept_confirm_dialog'),
        title: const Text(TruberCopy.quoteSelect),
        content: Text(
          '${quote.transporterLegalName ?? quote.transporterCompanyId}\n'
          '${TruberCopy.quoteRate}: ${quote.amount.display}',
        ),
        actions: [
          TextButton(
            key: const Key('accept_confirm_cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text(TruberCopy.ctaCancel),
          ),
          ElevatedButton(
            key: const Key('accept_confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(TruberCopy.quoteSelect),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    final session = context.read<SessionController>();
    try {
      final fresh = await session.quotations.getById(quote.id);
      final result = await session.quotations.accept(fresh.id);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        TruberPageRoute<void>.of(
          context,
          builder: (_) => BookingConfirmScreen(
            load: widget.load,
            booking: result.booking,
            quotation: result.quotation,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.quoteInboxTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.lg),
        children: [
          LoadCard(load: widget.load),
          const SizedBox(height: TruberSpacing.lg),
          Text(
            TruberCopy.quoteCompareHint,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          FutureBuilder<List<Quotation>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              final quotes = snap.data ?? [];
              if (quotes.isEmpty) {
                return const EmptyState(message: TruberCopy.quoteEmpty);
              }
              final canRestore =
                  quotes.any((q) => q.status == QuotationStatus.notSelected);
              return Column(
                children: [
                  if (canRestore) ...[
                    OutlinedButton(
                      key: const Key('restore_not_selected'),
                      onPressed: _busy ? null : _restore,
                      child: const Text(TruberCopy.quoteRestoreCta),
                    ),
                    const SizedBox(height: TruberSpacing.md),
                  ],
                  for (final q in quotes) ...[
                    Card(
                      child: Padding(
                        padding:
                            const EdgeInsets.all(TruberSpacing.cardPadding),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    q.transporterLegalName ??
                                        q.transporterCompanyId,
                                    style:
                                        Theme.of(context).textTheme.titleLarge,
                                  ),
                                ),
                                StatusChip(
                                  key: Key('quote_status_${q.id}'),
                                  label: quotationStatusLabel(q.status),
                                  tone: quotationStatusTone(q.status),
                                ),
                              ],
                            ),
                            const SizedBox(height: TruberSpacing.xs),
                            Text(
                              '${TruberCopy.quoteRate}: ${q.amount.display}',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .onSurface),
                            ),
                            if (q.notes != null) ...[
                              const SizedBox(height: TruberSpacing.xs),
                              Text(q.notes!,
                                  style: Theme.of(context).textTheme.bodySmall),
                            ],
                            FutureBuilder<bool?>(
                              future: _isBanned(q.transporterCompanyId),
                              builder: (context, ban) {
                                final blocked = ban.data == true ||
                                    q.counterpartyRestrictedAt(DateTime.now());
                                return Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    if (blocked) ...[
                                      const SizedBox(height: TruberSpacing.sm),
                                      Text(
                                        TruberCopy.banCounterpartyBlocked,
                                        key:
                                            Key('counterparty_blocked_${q.id}'),
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                                color: Theme.of(context)
                                                    .colorScheme
                                                    .onSurfaceVariant),
                                      ),
                                    ],
                                    const SizedBox(height: TruberSpacing.md),
                                    ElevatedButton(
                                      style: TruberAppTheme.fullWidthCta,
                                      key: Key('select_quote_${q.id}'),
                                      onPressed: _busy ||
                                              blocked ||
                                              q.status !=
                                                  QuotationStatus.submitted
                                          ? null
                                          : () => _select(q),
                                      child: const Text(TruberCopy.quoteSelect),
                                    ),
                                  ],
                                );
                              },
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: TruberSpacing.md),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/load.dart';
import '../../../models/quotation.dart';
import '../../../state/session.dart';
import '../../errors/error_messages.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/load_card.dart';
import '../../widgets/status_chip.dart';
import 'submit_quote_screen.dart';

/// Transporter's own quotations on one load (`GET /loads/{loadId}/quotations`
/// already returns only theirs; the company id is a second guard).
class TransporterQuotesScreen extends StatefulWidget {
  const TransporterQuotesScreen({super.key, required this.load});

  final FreightLoad load;

  @override
  State<TransporterQuotesScreen> createState() =>
      _TransporterQuotesScreenState();
}

class _TransporterQuotesScreenState extends State<TransporterQuotesScreen> {
  Future<List<Quotation>>? _future;
  bool _busy = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _reload();
    }
  }

  void _reload() {
    final session = context.read<SessionController>();
    final companyId = session.currentCompanyId;
    setState(() {
      _future = session.quotations.forLoad(widget.load.id).then((quotes) {
        if (companyId == null) return const <Quotation>[];
        return quotes
            .where((q) => q.transporterCompanyId == companyId)
            .toList();
      });
    });
  }

  Future<void> _withdraw(Quotation quote) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('withdraw_confirm_dialog'),
        title: const Text(TruberCopy.quoteWithdrawConfirmTitle),
        content: const Text(TruberCopy.quoteWithdrawConfirmBody),
        actions: [
          TextButton(
            key: const Key('withdraw_confirm_cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text(TruberCopy.ctaCancel),
          ),
          ElevatedButton(
            key: const Key('withdraw_confirm'),
            style: TruberAppTheme.destructive(
              Theme.of(dialogContext).brightness,
              Theme.of(dialogContext).textTheme,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text(TruberCopy.quoteWithdrawCta),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await context.read<SessionController>().quotations.withdraw(quote.id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(TruberCopy.quoteWithdrawn)),
    );
    _reload();
  }

  Future<void> _submit() async {
    await Navigator.of(context).push(
      TruberPageRoute<void>.of(
        context,
        builder: (_) => SubmitQuoteScreen(load: widget.load),
      ),
    );
    if (!mounted) return;
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.navQuotes)),
      body: ListView(
        key: const Key('transporter_quotes'),
        padding: const EdgeInsets.all(TruberSpacing.lg),
        children: [
          LoadCard(load: widget.load),
          const SizedBox(height: TruberSpacing.lg),
          FutureBuilder<List<Quotation>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              final quotes = snap.data ?? const <Quotation>[];
              final hasOpen =
                  quotes.any((q) => q.status == QuotationStatus.submitted);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (quotes.isEmpty)
                    const EmptyState(message: TruberCopy.quoteEmpty)
                  else
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
                                      '${TruberCopy.quoteRate}: ${q.amount.display}',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium,
                                    ),
                                  ),
                                  StatusChip(
                                    key: Key('my_quote_status_${q.id}'),
                                    label: quotationStatusLabel(q.status),
                                    tone: quotationStatusTone(q.status),
                                  ),
                                ],
                              ),
                              if (q.notes != null) ...[
                                const SizedBox(height: TruberSpacing.xs),
                                Text(q.notes!,
                                    style:
                                        Theme.of(context).textTheme.bodySmall),
                              ],
                              if (q.status == QuotationStatus.submitted) ...[
                                const SizedBox(height: TruberSpacing.md),
                                OutlinedButton(
                                  key: Key('withdraw_quote_${q.id}'),
                                  onPressed:
                                      _busy ? null : () => _withdraw(q),
                                  child: const Text(TruberCopy.quoteWithdrawCta),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: TruberSpacing.md),
                    ],
                  if (!hasOpen) ...[
                    const SizedBox(height: TruberSpacing.sm),
                    ElevatedButton(
                      key: const Key('open_submit_quote'),
                      style: TruberAppTheme.fullWidthCta,
                      onPressed: _busy ? null : _submit,
                      child: const Text(TruberCopy.quoteSubmitCta),
                    ),
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

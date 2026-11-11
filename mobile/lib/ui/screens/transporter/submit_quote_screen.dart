import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/load.dart';
import '../../../models/money.dart';
import '../../../models/quotation.dart';
import '../../../state/session.dart';
import '../../errors/error_messages.dart';
import '../../format/money_input.dart';
import '../../widgets/ban_banner.dart';
import '../../widgets/load_card.dart';

class SubmitQuoteScreen extends StatefulWidget {
  const SubmitQuoteScreen({super.key, required this.load});

  final FreightLoad load;

  @override
  State<SubmitQuoteScreen> createState() => _SubmitQuoteScreenState();
}

class _SubmitQuoteScreenState extends State<SubmitQuoteScreen> {
  final _rate = TextEditingController();
  final _notes = TextEditingController();
  bool _busy = false;
  MoneyAmount? _netPreview;
  bool _rateInvalid = false;
  int _previewSeq = 0;

  @override
  void initState() {
    super.initState();
    _rate.addListener(_updatePreview);
  }

  /// Net comes from PayoutRepository (server / mock); never computed here.
  Future<void> _updatePreview() async {
    final seq = ++_previewSeq;
    final repo = context.read<SessionController>().payouts;
    final minor = parseMoneyInputMinor(_rate.text);
    // QA-039: no hint until the input is a valid amount.
    if (minor == null || repo == null) {
      if (!mounted) return;
      setState(() => _netPreview = null);
    }
    if (_rateInvalid && minor != null) setState(() => _rateInvalid = false);
    MoneyAmount? net;
    if (repo != null && minor != null) {
      net = await repo.quoteNetPreview(
        widget.load.id,
        MoneyAmount(amountMinor: minor, currency: widget.load.currency),
      );
    }
    if (!mounted || seq != _previewSeq) return;
    setState(() => _netPreview = net);
  }

  @override
  void dispose() {
    _rate.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (blockIfBanned(context)) return;
    final rateMinor = parseMoneyInputMinor(_rate.text);
    if (rateMinor == null) {
      // QA-039: error.amount_invalid under the field + form-level
      // error.validation snackbar (existing pattern).
      setState(() => _rateInvalid = true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          key: Key('money_invalid_snackbar'),
          content: Text(TruberCopy.errorValidation),
        ),
      );
      return;
    }
    final session = context.read<SessionController>();
    final companyId = session.currentCompanyId;
    if (companyId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(TruberCopy.verifyNeeded)),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await session.quotations.submit(
        widget.load.id,
        CreateQuotationRequest(
          transporterCompanyId: companyId,
          amount: MoneyAmount(
            amountMinor: rateMinor,
            currency: widget.load.currency,
          ),
          notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
          validUntil: DateTime.now().toUtc().add(const Duration(days: 3)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(TruberCopy.quoteSent)),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.quoteSubmitTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          LoadCard(load: widget.load),
          const SizedBox(height: TruberSpacing.xl),
          TextField(
            key: const Key('quote_rate'),
            controller: _rate,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: TruberCopy.quoteRate,
              errorText: _rateInvalid ? TruberCopy.errorAmountInvalid : null,
              errorMaxLines: 3,
            ),
          ),
          if (_netPreview != null) ...[
            const SizedBox(height: TruberSpacing.sm),
            Text(
              TruberCopy.payoutQuoteHintFor(_netPreview!.display),
              key: const Key('quote_payout_hint'),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            controller: _notes,
            maxLines: 3,
            decoration:
                const InputDecoration(labelText: TruberCopy.quoteNotesLabel),
          ),
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            style: TruberAppTheme.fullWidthCta,
            key: const Key('quote_submit'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.quoteSubmitCta),
          ),
        ],
      ),
    );
  }
}

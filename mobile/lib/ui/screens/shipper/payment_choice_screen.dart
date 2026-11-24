import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/booking.dart';
import '../../../models/load.dart';
import '../../../models/money.dart';
import '../../../models/payment.dart';
import '../../../state/session.dart';
import '../../errors/error_messages.dart';

class PaymentChoiceScreen extends StatefulWidget {
  const PaymentChoiceScreen({
    super.key,
    required this.booking,
    required this.load,
    this.initialMethod = PaymentMethod.cash,
  });

  final Booking booking;
  final FreightLoad load;
  final PaymentMethod initialMethod;

  @override
  State<PaymentChoiceScreen> createState() => _PaymentChoiceScreenState();
}

class _PaymentChoiceScreenState extends State<PaymentChoiceScreen> {
  late PaymentMethod _method = isLaunchPaymentMethod(widget.initialMethod)
      ? widget.initialMethod
      : PaymentMethod.cash;
  bool _busy = false;

  MoneyAmount get _total => widget.booking.agreedAmount;

  Future<void> _submit() async {
    setState(() => _busy = true);
    final session = context.read<SessionController>();
    final request = CreatePaymentArrangementRequest(
      method: _method,
      totalAmount: _total,
    );
    try {
      final arrangement =
          await session.payments.propose(widget.booking.id, request);
      if (!mounted) return;
      Navigator.of(context).pop(arrangement);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e, onRetry: _submit);
    }
  }

  String _title(PaymentMethod method) => switch (method) {
        PaymentMethod.cash => TruberCopy.payCash,
        PaymentMethod.directTransfer => TruberCopy.payBankTransfer,
        _ => TruberCopy.payCash,
      };

  String _help(PaymentMethod method) => switch (method) {
        PaymentMethod.cash => TruberCopy.payCashHelp,
        PaymentMethod.directTransfer => TruberCopy.payBankTransferHelp,
        _ => TruberCopy.payCashHelp,
      };

  Widget _option(PaymentMethod method) {
    final selected = _method == method;
    return Card(
      key: Key(method == PaymentMethod.cash
          ? 'pay_option_cash'
          : 'pay_option_bank_transfer'),
      color: selected
          ? (Theme.of(context).brightness == Brightness.dark
              ? TruberColors.primarySoftDark
              : TruberColors.primarySoft)
          : Theme.of(context).colorScheme.surface,
      child: InkWell(
        onTap: () => setState(() => _method = method),
        borderRadius: TruberRadii.borderMd,
        child: Padding(
          padding: const EdgeInsets.all(TruberSpacing.cardPadding),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selected
                    ? (Theme.of(context).brightness == Brightness.dark
                        ? TruberColors.primaryTextDark
                        : TruberColors.primary)
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: TruberSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _title(method),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: TruberSpacing.xs),
                    Text(
                      _help(method),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.payTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.payChoose,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: TruberSpacing.sm),
          Text(
            TruberCopy.payTotalFor(_total.display),
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurface,
                ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          for (final method in kLaunchPaymentMethods) ...[
            _option(method),
            const SizedBox(height: TruberSpacing.md),
          ],
          ElevatedButton(
            style: TruberAppTheme.fullWidthCta,
            key: const Key('propose_payment_cta'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.payProposeCta),
          ),
        ],
      ),
    );
  }
}

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
import '../../widgets/payment_badges.dart';

class PaymentChoiceScreen extends StatefulWidget {
  const PaymentChoiceScreen({
    super.key,
    required this.booking,
    required this.load,
    this.initialMethod = PaymentMethod.depositBalance,
  });

  final Booking booking;
  final FreightLoad load;
  final PaymentMethod initialMethod;

  @override
  State<PaymentChoiceScreen> createState() => _PaymentChoiceScreenState();
}

class _PaymentChoiceScreenState extends State<PaymentChoiceScreen> {
  /// The split is offered only when both parts are >= 1 minor unit.
  late final _split = depositBalanceSplit(widget.booking.agreedAmount);
  late PaymentMethod _method =
      widget.initialMethod == PaymentMethod.depositBalance && _split == null
          ? PaymentMethod.prepay
          : widget.initialMethod;
  int _creditDays = 14;
  bool _cashAck = false;
  bool _busy = false;

  MoneyAmount get _total => widget.booking.agreedAmount;

  Future<void> _submit() async {
    if (_method == PaymentMethod.cash && !_cashAck) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(TruberCopy.payCashAck)),
      );
      return;
    }
    final split = _method == PaymentMethod.depositBalance ? _split : null;
    if (_method == PaymentMethod.depositBalance && split == null) return;
    setState(() => _busy = true);
    final session = context.read<SessionController>();
    final request = CreatePaymentArrangementRequest(
      method: _method,
      totalAmount: _total,
      depositAmount: split?.deposit,
      balanceAmount: split?.balance,
      corporateCreditTermsDays:
          _method == PaymentMethod.corporateCredit ? _creditDays : null,
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

  Widget _option({
    required PaymentMethod method,
    required String title,
    required String help,
    required Widget badge,
    required Key key,
    bool cashStyle = false,
  }) {
    final selected = _method == method;
    return Card(
      key: key,
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
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        badge,
                      ],
                    ),
                    const SizedBox(height: TruberSpacing.xs),
                    Text(
                      help,
                      style: cashStyle
                          ? Theme.of(context).textTheme.labelLarge?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: Theme.of(context).brightness ==
                                        Brightness.dark
                                    ? TruberColors.paymentCashBorderDark
                                    : TruberColors.paymentCashBorder,
                              )
                          : Theme.of(context).textTheme.bodySmall,
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
          if (_split != null)
            _option(
              key: const Key('pay_option_deposit_balance'),
              method: PaymentMethod.depositBalance,
              title: TruberCopy.payDepositBalance,
              help: TruberCopy.payDepositBalanceHelp,
              badge: const ProtectedPaymentBadge(),
            ),
          if (_split != null) ...[
            const SizedBox(height: TruberSpacing.xs),
            Text(
              TruberCopy.paySplitHint,
              key: const Key('pay_split_hint'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
          if (_method == PaymentMethod.depositBalance && _split != null) ...[
            const SizedBox(height: TruberSpacing.sm),
            Card(
              key: const Key('deposit_split_card'),
              child: Padding(
                padding: const EdgeInsets.all(TruberSpacing.cardPadding),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      TruberCopy.payDepositLabelFor(_split.deposit.display),
                      key: const Key('deposit_amount_preview'),
                    ),
                    Text(
                      TruberCopy.payBalanceLabelFor(_split.balance.display),
                      key: const Key('balance_amount_preview'),
                    ),
                  ],
                ),
              ),
            ),
          ],
          if (_split != null) const SizedBox(height: TruberSpacing.md),
          _option(
            key: const Key('pay_option_prepay'),
            method: PaymentMethod.prepay,
            title: TruberCopy.payPrepay,
            help: TruberCopy.payPrepayHelp,
            badge: const ProtectedPaymentBadge(),
          ),
          const SizedBox(height: TruberSpacing.md),
          _option(
            key: const Key('pay_option_escrow'),
            method: PaymentMethod.escrow,
            title: TruberCopy.payProtected,
            help: TruberCopy.payProtectedHelp,
            badge: const ProtectedPaymentBadge(),
          ),
          const SizedBox(height: TruberSpacing.md),
          _option(
            key: const Key('pay_option_corporate_credit'),
            method: PaymentMethod.corporateCredit,
            title: TruberCopy.payCorporateCredit,
            help: TruberCopy.payCorporateCreditHelp,
            badge: const ProtectedPaymentBadge(),
          ),
          if (_method == PaymentMethod.corporateCredit) ...[
            const SizedBox(height: TruberSpacing.sm),
            const Text(TruberCopy.payCreditTermsLabel),
            const SizedBox(height: TruberSpacing.sm),
            Wrap(
              spacing: TruberSpacing.sm,
              children: [7, 14, 30].map((d) {
                final selected = _creditDays == d;
                return ChoiceChip(
                  label: Text('$d'),
                  selected: selected,
                  onSelected: (_) => setState(() => _creditDays = d),
                );
              }).toList(),
            ),
          ],
          const SizedBox(height: TruberSpacing.md),
          _option(
            key: const Key('pay_option_cash'),
            method: PaymentMethod.cash,
            title: TruberCopy.payCash,
            help: TruberCopy.payCashHelp,
            badge: const CashWarningBadge(),
            cashStyle: true,
          ),
          if (_method == PaymentMethod.cash) ...[
            const SizedBox(height: TruberSpacing.sm),
            CheckboxListTile(
              key: const Key('cash_ack_checkbox'),
              contentPadding: EdgeInsets.zero,
              value: _cashAck,
              onChanged: (v) => setState(() => _cashAck = v ?? false),
              title: const Text(TruberCopy.payCashAck),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          ],
          const SizedBox(height: TruberSpacing.lg),
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

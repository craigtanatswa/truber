import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../data/repositories/booking_repository.dart';
import '../../../models/booking.dart';
import '../../../models/load.dart';
import '../../../models/payment.dart';
import '../../../models/quotation.dart';
import '../../../state/session.dart';
import '../../widgets/ban_banner.dart';
import '../../widgets/load_card.dart';
import '../offplatform/offplatform_entry.dart';
import '../../errors/error_messages.dart';
import '../../widgets/payment_badges.dart';
import '../../widgets/status_chip.dart';
import 'payment_choice_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

class BookingConfirmScreen extends StatefulWidget {
  const BookingConfirmScreen({
    super.key,
    required this.load,
    required this.booking,
    required this.quotation,
  });

  final FreightLoad load;
  final Booking booking;
  final Quotation quotation;

  @override
  State<BookingConfirmScreen> createState() => _BookingConfirmScreenState();
}

class _BookingConfirmScreenState extends State<BookingConfirmScreen> {
  late Booking _booking = widget.booking;
  PaymentArrangement? _arrangement;
  bool _busy = false;
  String? _gateError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refreshArrangement();
    });
  }

  Future<void> _refreshArrangement() async {
    final arr = await context
        .read<SessionController>()
        .payments
        .latestForBooking(_booking.id);
    if (!mounted) return;
    setState(() => _arrangement = arr);
  }

  Future<void> _openPayment() async {
    final updated = await Navigator.of(context).push<PaymentArrangement>(
      TruberPageRoute.of(
        context,
        builder: (_) => PaymentChoiceScreen(
          booking: _booking,
          load: widget.load,
        ),
      ),
    );
    if (updated != null) {
      setState(() {
        _arrangement = updated;
        _gateError = null;
      });
    } else {
      await _refreshArrangement();
    }
  }

  Future<void> _confirmBooking() async {
    if (blockIfBanned(context)) return;
    setState(() {
      _busy = true;
      _gateError = null;
    });
    try {
      final confirmed =
          await context.read<SessionController>().bookings.confirm(_booking.id);
      if (!mounted) return;
      setState(() {
        _booking = confirmed;
        _busy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(TruberCopy.bookingConfirmed)),
      );
    } on BookingGateException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _gateError = mapErrorMessage(e);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _gateError = mapErrorMessage(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final canConfirm =
        _arrangement?.isConfirmed == true && !_booking.isConfirmed;
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.bookingConfirmTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.bookingSummary,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: TruberSpacing.lg),
          LoadCard(load: widget.load),
          const SizedBox(height: TruberSpacing.lg),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(TruberSpacing.cardPadding),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.quotation.transporterLegalName ??
                        widget.quotation.transporterCompanyId,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: TruberSpacing.xs),
                  Text(
                    TruberCopy.bookingAgreedFor(_booking.agreedAmount.display),
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                  ),
                  const SizedBox(height: TruberSpacing.sm),
                  StatusChip.booking(
                    _booking.status,
                    key: const Key('booking_status_chip'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          Container(
            key: const Key('booking_no_payment_rule'),
            padding: const EdgeInsets.all(TruberSpacing.lg),
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? TruberColors.warningSoftDark
                  : TruberColors.warningSoft,
              borderRadius: TruberRadii.borderMd,
              border: Border.all(
                color: Theme.of(context).brightness == Brightness.dark
                    ? TruberColors.warningDark
                    : TruberColors.warning,
              ),
            ),
            child: Text(
              TruberCopy.bookingNoPaymentRule,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          Text(
            TruberCopy.bookingPaymentStatusTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: TruberSpacing.md),
          _PaymentStatusCard(arrangement: _arrangement),
          const SizedBox(height: TruberSpacing.lg),
          if (_arrangement == null)
            ElevatedButton(
              key: const Key('choose_payment_cta'),
              onPressed: _openPayment,
              child: const Text(TruberCopy.bookingContinuePayment),
            )
          else
            OutlinedButton(
              key: const Key('change_payment_cta'),
              onPressed: _booking.isConfirmed ? null : _openPayment,
              child: const Text(TruberCopy.bookingContinuePayment),
            ),
          const SizedBox(height: TruberSpacing.md),
          Text(
            TruberCopy.bookingAgreement,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (_gateError != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              _gateError!,
              key: const Key('booking_gate_error'),
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('confirm_booking_cta'),
            onPressed: canConfirm && !_busy ? _confirmBooking : null,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    _booking.isConfirmed
                        ? TruberCopy.bookingConfirmed
                        : TruberCopy.bookingConfirmCta,
                  ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          OffPlatformEntry(bookingId: _booking.id),
        ],
      ),
    );
  }
}

class _PaymentStatusCard extends StatelessWidget {
  const _PaymentStatusCard({this.arrangement});

  final PaymentArrangement? arrangement;

  @override
  Widget build(BuildContext context) {
    if (arrangement == null) {
      return Card(
        key: const Key('payment_status_none'),
        child: Padding(
          padding: const EdgeInsets.all(TruberSpacing.cardPadding),
          child: Text(
            TruberCopy.payStatusPending,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      );
    }
    final a = arrangement!;
    final statusText = a.isCash && a.isConfirmed
        ? TruberCopy.payStatusCashRecorded
        : a.isConfirmed
            ? TruberCopy.payStatusSecured
            : TruberCopy.payStatusPending;
    return Card(
      key: const Key('payment_status_card'),
      child: Padding(
        padding: const EdgeInsets.all(TruberSpacing.cardPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    statusText,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (a.isCash)
                  const CashWarningBadge()
                else if (a.isConfirmed)
                  const ProtectedPaymentBadge(),
              ],
            ),
            const SizedBox(height: TruberSpacing.sm),
            Text(paymentMethodLabel(a.method)),
            Text(TruberCopy.payTotalFor(a.totalAmount.display)),
            if (a.method == PaymentMethod.depositBalance &&
                a.depositAmount != null &&
                a.balanceAmount != null) ...[
              Text(
                TruberCopy.payDepositLabelFor(a.depositAmount!.display),
                key: const Key('deposit_amount'),
              ),
              Text(
                TruberCopy.payBalanceLabelFor(a.balanceAmount!.display),
                key: const Key('balance_amount'),
              ),
            ],
            const SizedBox(height: TruberSpacing.sm),
            Wrap(
              key: const Key('payment_arrangement_status_row'),
              spacing: TruberSpacing.sm,
              runSpacing: TruberSpacing.xs,
              children: [
                StatusChip(
                  key: const Key('arrangement_status_chip'),
                  label: arrangementStatusLabel(a.arrangementStatus),
                  tone: arrangementStatusTone(a.arrangementStatus),
                ),
                StatusChip(
                  key: const Key('protection_status_chip'),
                  label: protectionStatusLabel(a.protectionStatus),
                  tone: protectionStatusTone(a.protectionStatus),
                  borderColor: protectionUsesCashBorder(a.protectionStatus)
                      ? (Theme.of(context).brightness == Brightness.dark
                          ? TruberColors.paymentCashBorderDark
                          : TruberColors.paymentCashBorder)
                      : null,
                  foregroundColor: protectionUsesCashBorder(a.protectionStatus)
                      ? (Theme.of(context).brightness == Brightness.dark
                          ? TruberColors.warningDark
                          : TruberColors.warning)
                      : null,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

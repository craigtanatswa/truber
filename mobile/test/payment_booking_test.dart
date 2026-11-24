import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/data/repositories/booking_repository.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/screens/shipper/booking_confirm_screen.dart';
import 'package:truber_app/ui/screens/shipper/payment_choice_screen.dart';
import 'package:truber_design/truber_design.dart';

void _resetStore({required bool autoConfirm}) {
  MockStores.instance.quotations
    ..clear()
    ..addAll(seedQuotations());
  MockStores.instance.bookings.clear();
  MockStores.instance.arrangements.clear();
  MockStores.instance.autoConfirmArrangements = autoConfirm;
}

SessionController _session({required bool autoConfirm}) {
  _resetStore(autoConfirm: autoConfirm);
  final loads = MockLoadRepository();
  return SessionController(
    enforceSessionExpiry: false,
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
  );
}

Future<void> _setPhoneSurface(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(390, 2400));
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
  });
}

void main() {
  test('QA-013 money displays as US\$ with commas', () {
    expect(
      const MoneyAmount(amountMinor: 100000, currency: 'USD').display,
      'US\$1,000.00',
    );
    expect(
      const MoneyAmount(amountMinor: 100050, currency: 'USD').display,
      'US\$1,000.50',
    );
    expect(
      const MoneyAmount(amountMinor: 95000, currency: 'USD').amountDigits,
      '950.00',
    );
    expect(
      const MoneyAmount(amountMinor: 100050, currency: 'USD').amountDigits,
      '1,000.50',
    );
  });

  test('QA-012 deposit/balance labels use Design templates', () {
    final label = TruberCopy.payDepositLabelFor('US\$475.00');
    expect(label, 'Deposit now: US\$475.00');
    expect(TruberCopy.payBalanceLabelFor('US\$475.00'),
        'Balance on delivery: US\$475.00');
    expect(TruberCopy.payDepositLabel.contains('50%'), isFalse);
    expect(TruberCopy.payBalanceLabel.contains('50%'), isFalse);
    expect(label.contains('TODO:'), isFalse);
    expect(TruberCopy.payProposeCta.contains('TODO:'), isFalse);
    expect(TruberCopy.bookingContinuePayment.contains('TODO:'), isFalse);
  });

  test('QA-014 cash help has no markdown asterisks', () {
    expect(TruberCopy.payCashHelp.contains('**'), isFalse);
    expect(
      TruberCopy.payCashHelp,
      'Pay the transporter directly. Agree the amount and timing with them.',
    );
  });

  testWidgets('payment choice shows only cash and bank transfer',
      (tester) async {
    await _setPhoneSurface(tester);
    final session = _session(autoConfirm: true);
    await session.login('shipper@truber.zw', 'demopass');
    final load = await session.loads.getById(MockIds.load1);
    final accepted = await session.quotations.accept(MockIds.quote1);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: PaymentChoiceScreen(
            booking: accepted.booking,
            load: load,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(TruberCopy.payCash), findsOneWidget);
    expect(find.text(TruberCopy.payBankTransfer), findsOneWidget);
    expect(find.byKey(const Key('pay_option_cash')), findsOneWidget);
    expect(find.byKey(const Key('pay_option_bank_transfer')), findsOneWidget);
    expect(find.text(TruberCopy.payPrepay), findsNothing);
    expect(find.text(TruberCopy.payDepositBalance), findsNothing);
    expect(find.text(TruberCopy.payProtected), findsNothing);
    expect(find.text(TruberCopy.payCorporateCredit), findsNothing);
    expect(find.text(TruberCopy.payCashAck), findsNothing);
    expect(find.text(TruberCopy.payBankTransferAck), findsNothing);
    expect(find.text(TruberCopy.payCommissionNote), findsNothing);
    expect(find.textContaining('protected'), findsNothing);
    expect(find.textContaining('Protected'), findsNothing);
    expect(find.text(TruberCopy.payProposeCta), findsOneWidget);
  });

  testWidgets('booking proceeds without a payment acknowledgement',
      (tester) async {
    await _setPhoneSurface(tester);
    final session = _session(autoConfirm: true);
    await session.login('shipper@truber.zw', 'demopass');
    final load = await session.loads.getById(MockIds.load1);
    final accepted = await session.quotations.accept(MockIds.quote1);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: PaymentChoiceScreen(
            booking: accepted.booking,
            load: load,
            initialMethod: PaymentMethod.cash,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(Checkbox), findsNothing);
    await tester.tap(find.byKey(const Key('propose_payment_cta')));
    await tester.pumpAndSettle();
    final arranged = await session.payments.latestForBooking(accepted.booking.id);
    expect(arranged?.method, PaymentMethod.cash);
    expect(arranged?.isConfirmed, isTrue);
  });

  test('booking confirm gated without confirmed arrangement', () async {
    final session = _session(autoConfirm: false);
    await session.login('shipper@truber.zw', 'demopass');
    final accepted = await session.quotations.accept(MockIds.quote1);
    final booking = accepted.booking;

    await expectLater(
      session.bookings.confirm(booking.id),
      throwsA(isA<BookingGateException>()),
    );

    final proposed = await session.payments.propose(
      booking.id,
      CreatePaymentArrangementRequest(
        method: PaymentMethod.prepay,
        totalAmount: booking.agreedAmount,
      ),
    );
    expect(proposed.isConfirmed, isFalse);
    await expectLater(
      session.bookings.confirm(booking.id),
      throwsA(isA<BookingGateException>()),
    );
  });

  testWidgets('confirmed arrangement enables booking confirm', (tester) async {
    await _setPhoneSurface(tester);
    final session = _session(autoConfirm: true);
    await session.login('shipper@truber.zw', 'demopass');
    final load = await session.loads.getById(MockIds.load1);
    final accepted = await session.quotations.accept(MockIds.quote1);
    final booking = accepted.booking;
    final total = booking.agreedAmount;
    await session.payments.propose(
      booking.id,
      CreatePaymentArrangementRequest(
        method: PaymentMethod.cash,
        totalAmount: total,
      ),
    );

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: BookingConfirmScreen(
            load: load,
            booking: booking,
            quotation: accepted.quotation,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(TruberCopy.payStatusCashRecorded), findsOneWidget);
    expect(find.text(TruberCopy.bookingNoPaymentRule), findsOneWidget);
    expect(find.byKey(const Key('confirm_booking_cta')), findsOneWidget);
    expect(find.byKey(const Key('arrangement_status_chip')), findsOneWidget);
    expect(find.byKey(const Key('protection_status_chip')), findsNothing);
    expect(find.textContaining('protected'), findsNothing);
    expect(find.textContaining('Protected'), findsNothing);
    expect(find.text(TruberCopy.payCommissionNote), findsNothing);
    expect(find.text('Arrangement: confirmed'), findsNothing);
    expect(find.textContaining('Protection: none'), findsNothing);

    final enabled = tester.widget<ElevatedButton>(
      find.byKey(const Key('confirm_booking_cta')),
    );
    expect(enabled.onPressed, isNotNull);

    await tester.tap(find.byKey(const Key('confirm_booking_cta')));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.bookingConfirmed), findsWidgets);
  });
}

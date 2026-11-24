import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_company_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_offplatform_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_payout_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/models/booking.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/format/money_input.dart';
import 'package:truber_app/ui/screens/shipper/payment_choice_screen.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_design/truber_design.dart';

class _RecordingPayments extends MockPaymentRepository {
  final sent = <CreatePaymentArrangementRequest>[];
  @override
  Future<PaymentArrangement> propose(
      String bookingId, CreatePaymentArrangementRequest request) {
    sent.add(request);
    return super.propose(bookingId, request);
  }
}

SessionController _session(MockPaymentRepository payments) {
  final loads = MockLoadRepository();
  return SessionController(
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: payments,
    payouts: MockPayoutRepository(),
    reports: MockOffPlatformReportRepository(),
    companyDirectory: MockCompanyRepository(),
    enforceSessionExpiry: false,
    clock: () => DateTime.utc(2026, 11, 10, 12),
  );
}

Booking _booking(int minor) => Booking(
      id: 'b-split-$minor',
      loadId: MockIds.load1,
      quotationId: MockIds.quote1,
      shipperCompanyId: 'c1',
      transporterCompanyId: 'c2',
      status: BookingStatus.pendingPaymentArrangement,
      tripStatus: TripStatus.notStarted,
      completionStatus: CompletionStatus.notComplete,
      agreedAmount: MoneyAmount(amountMinor: minor, currency: 'USD'),
      commissionRateBps: 500,
      createdAt: DateTime.utc(2026, 11, 10),
      updatedAt: DateTime.utc(2026, 11, 10),
    );

void main() {
  group('QA-044 thousands grouping', () {
    test('valid grouping accepted', () {
      expect(parseMoneyInputMinor('1,000'), 100000);
      expect(parseMoneyInputMinor('12,345.67'), 1234567);
      expect(parseMoneyInputMinor('123,456,789'), 12345678900);
      expect(parseMoneyInputMinor('US\$1,000.00'), 100000);
    });
    test('ambiguous / malformed grouping refused', () {
      for (final bad in [
        '0,100',
        '0,000',
        '00,100',
        '0,100.00',
        '01,000',
        '1,00',
        '1000,50',
        '1,0000',
        '12,34',
        ',100',
        '1,',
        '1,000,',
        '1,,000',
        '1,000,00',
        '1234,567',
      ]) {
        expect(parseMoneyInputMinor(bad), isNull, reason: bad);
      }
    });

    testWidgets('quote "0,100" shows error.amount_invalid, nothing sent',
        (tester) async {
      final load = seedLoads().first;
      int count() => MockStores.instance.quotations
          .where((q) => q.loadId == load.id)
          .length;
      final before = count();
      final s = _session(MockPaymentRepository());
      await s.login('transporter@truber.zw', 'demopass');
      await tester.pumpWidget(ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
              theme: TruberTheme.light(),
              home: SubmitQuoteScreen(load: load))));
      await tester.enterText(find.byKey(const Key('quote_rate')), '0,100');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('quote_payout_hint')), findsNothing);
      await tester.tap(find.byKey(const Key('quote_submit')));
      await tester.pump();
      expect(find.text(TruberCopy.errorAmountInvalid), findsOneWidget);
      expect(count(), before);
    });
  });

  group('deposit/balance split needs both parts >= 1 minor unit', () {
    test('depositBalanceSplit', () {
      MoneyAmount m(int v) => MoneyAmount(amountMinor: v, currency: 'USD');
      expect(depositBalanceSplit(m(1)), isNull);
      expect(depositBalanceSplit(m(0)), isNull);
      final two = depositBalanceSplit(m(2))!;
      expect([two.deposit.amountMinor, two.balance.amountMinor], [1, 1]);
      final three = depositBalanceSplit(m(3))!;
      expect([three.deposit.amountMinor, three.balance.amountMinor], [1, 2]);
      final big = depositBalanceSplit(m(95001))!;
      expect(big.deposit.amountMinor + big.balance.amountMinor, 95001);
    });

    test('mock repo rejects a zero part like the contract', () async {
      final repo = MockPaymentRepository();
      MoneyAmount m(int v) => MoneyAmount(amountMinor: v, currency: 'USD');
      expect(
        () => repo.propose(
            'b',
            CreatePaymentArrangementRequest(
              method: PaymentMethod.depositBalance,
              totalAmount: m(1),
              depositAmount: m(0),
              balanceAmount: m(1),
            )),
        throwsArgumentError,
      );
    });

    Future<_RecordingPayments> pump(WidgetTester tester, int minor) async {
      await tester.binding.setSurfaceSize(const Size(400, 1400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final rec = _RecordingPayments();
      final s = _session(rec);
      await s.login('shipper@truber.zw', 'demopass');
      final load = await s.loads.getById(MockIds.load1);
      await tester.pumpWidget(ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
              theme: TruberTheme.light(),
              home:
                  PaymentChoiceScreen(booking: _booking(minor), load: load))));
      await tester.pumpAndSettle();
      return rec;
    }

    testWidgets('US\$0.01 total: split not offered; prepay sent, no parts',
        (tester) async {
      final rec = await pump(tester, 1);
      expect(find.byKey(const Key('pay_option_deposit_balance')), findsNothing);
      expect(find.byKey(const Key('deposit_split_card')), findsNothing);
      expect(find.byKey(const Key('pay_split_hint')), findsNothing);
      for (final k in [
        'pay_option_prepay',
        'pay_option_escrow',
        'pay_option_corporate_credit',
        'pay_option_cash',
      ]) {
        expect(find.byKey(Key(k)), findsOneWidget, reason: k);
      }
      final cta = find.byKey(const Key('propose_payment_cta'));
      await tester.scrollUntilVisible(cta, 200,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(cta);
      await tester.pumpAndSettle();
      expect(rec.sent.single.method, PaymentMethod.prepay);
      expect(rec.sent.single.depositAmount, isNull);
      expect(rec.sent.single.balanceAmount, isNull);
    });

    testWidgets('US\$0.03 odd total: labels US\$0.01 / US\$0.02, hint shown',
        (tester) async {
      final rec = await pump(tester, 3);
      expect(
          find.text(TruberCopy.payDepositLabelFor('US\$0.01')), findsOneWidget);
      expect(
          find.text(TruberCopy.payBalanceLabelFor('US\$0.02')), findsOneWidget);
      expect(find.text(TruberCopy.paySplitHint), findsOneWidget);
      final cta = find.byKey(const Key('propose_payment_cta'));
      await tester.scrollUntilVisible(cta, 200,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(cta);
      await tester.pumpAndSettle();
      final r = rec.sent.single;
      expect(
          [r.depositAmount!.amountMinor, r.balanceAmount!.amountMinor], [1, 2]);
    });

    testWidgets('US\$0.02 total: split offered and sent as 0.01 / 0.01',
        (tester) async {
      final rec = await pump(tester, 2);
      expect(find.byKey(const Key('deposit_split_card')), findsOneWidget);
      final cta = find.byKey(const Key('propose_payment_cta'));
      await tester.scrollUntilVisible(cta, 200,
          scrollable: find.byType(Scrollable).first);
      await tester.tap(cta);
      await tester.pumpAndSettle();
      final r = rec.sent.single;
      expect(r.method, PaymentMethod.depositBalance);
      expect(
          [r.depositAmount!.amountMinor, r.balanceAmount!.amountMinor], [1, 1]);
    });
  });
}

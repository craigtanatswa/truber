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
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/format/dates.dart';
import 'package:truber_app/ui/format/money_input.dart';
import 'package:truber_app/ui/screens/shipper/post_load_screen.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_app/ui/screens/transporter/transporter_home.dart';
import 'package:truber_design/truber_design.dart';

SessionController _session() {
  final loads = MockLoadRepository();
  return SessionController(
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
    payouts: MockPayoutRepository(),
    reports: MockOffPlatformReportRepository(),
    companyDirectory: MockCompanyRepository(),
    enforceSessionExpiry: false,
    clock: () => DateTime.utc(2026, 11, 10, 12),
  );
}

Widget _host(SessionController s, Widget child) => ChangeNotifierProvider.value(
      value: s,
      child: MaterialApp(theme: TruberTheme.light(), home: child),
    );

void main() {
  group('QA-039 parseMoneyInputMinor (≥ 0.01, ≤ 2 decimals, no floats)', () {
    test('valid', () {
      expect(parseMoneyInputMinor('950'), 95000);
      expect(parseMoneyInputMinor('950.5'), 95050);
      expect(parseMoneyInputMinor('100.01'), 10001);
      expect(parseMoneyInputMinor(' 1,000.00 '), 100000);
      expect(parseMoneyInputMinor('US\$1,000.00'), 100000);
      expect(parseMoneyInputMinor('0.01'), 1);
      // Float-free: 0.29 * 100 = 28.999… with doubles.
      expect(parseMoneyInputMinor('0.29'), 29);
      expect(parseMoneyInputMinor('1234567.89'), 123456789);
    });
    test('invalid', () {
      for (final bad in [
        '0.001',
        '100.009',
        '0',
        '0.00',
        '0.0',
        '',
        ' ',
        '-5',
        'abc',
        '1e3',
        '.5',
        '5.',
        '1,00',
        '1.2.3',
        '12,34.00',
        'NaN',
        'Infinity',
      ]) {
        expect(parseMoneyInputMinor(bad), isNull, reason: bad);
      }
    });
  });

  int quotesFor(String loadId) =>
      MockStores.instance.quotations.where((q) => q.loadId == loadId).length;

  for (final bad in ['0.001', '100.009', '0']) {
    testWidgets('QA-039 quote "$bad" is refused before any request, no hint',
        (tester) async {
      final load = seedLoads().first;
      final before = quotesFor(load.id);
      final s = _session();
      await s.login('transporter@truber.zw', 'demopass');
      await tester.pumpWidget(_host(s, SubmitQuoteScreen(load: load)));
      await tester.enterText(find.byKey(const Key('quote_rate')), bad);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('quote_payout_hint')), findsNothing);
      expect(find.textContaining('US\$0.00'), findsNothing);
      await tester.tap(find.byKey(const Key('quote_submit')));
      await tester.pump();
      expect(find.byKey(const Key('money_invalid_snackbar')), findsOneWidget);
      expect(find.text(TruberCopy.errorValidation), findsOneWidget);
      final field =
          tester.widget<TextField>(find.byKey(const Key('quote_rate')));
      expect(field.decoration?.errorText, TruberCopy.errorAmountInvalid);
      expect(field.decoration?.errorMaxLines, greaterThan(1), reason: 'wraps');
      expect(find.text(TruberCopy.errorAmountInvalid), findsOneWidget);
      expect(quotesFor(load.id), before);
    });
  }

  testWidgets('QA-039 valid quote sends exact minor units; hint appears',
      (tester) async {
    final load = seedLoads().first;
    final before = quotesFor(load.id);
    final s = _session();
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, SubmitQuoteScreen(load: load)));
    await tester.enterText(find.byKey(const Key('quote_rate')), '100.009');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('quote_payout_hint')), findsNothing);
    await tester.enterText(find.byKey(const Key('quote_rate')), '100.01');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('quote_payout_hint')), findsOneWidget);
    await tester.tap(find.byKey(const Key('quote_submit')));
    await tester.pumpAndSettle();
    expect(quotesFor(load.id), before + 1);
    final created =
        MockStores.instance.quotations.where((q) => q.loadId == load.id).last;
    expect(created.amount.amountMinor, 10001);
  });

  testWidgets('QA-039 post load offered rate uses the same rule',
      (tester) async {
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    Future<List<dynamic>> mine() => s.loads.listForCompany(s.currentCompanyId!);
    final before = (await mine()).length;
    await tester.pumpWidget(_host(s, const PostLoadScreen()));
    await tester.enterText(find.byKey(const Key('post_pickup')), 'Harare');
    await tester.enterText(find.byKey(const Key('post_destination')), 'Gweru');
    await tester.enterText(find.byKey(const Key('post_goods')), 'Maize');
    await tester.enterText(find.byKey(const Key('post_weight')), '10');
    final rate = find.byKey(const Key('load_rate'));
    final submit = find.byKey(const Key('post_load_submit'));
    for (final bad in ['0.001', '100.009', '0']) {
      await tester.scrollUntilVisible(rate, 200,
          scrollable: find.byType(Scrollable).first);
      await tester.enterText(rate, bad);
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pump();
      expect(find.byKey(const Key('money_invalid_snackbar')), findsWidgets,
          reason: bad);
      expect(find.text(TruberCopy.errorAmountInvalid), findsOneWidget,
          reason: bad);
      expect((await mine()).length, before, reason: bad);
      ScaffoldMessenger.of(tester.element(submit)).clearSnackBars();
      await tester.pumpAndSettle();
    }
    await tester.scrollUntilVisible(rate, 200,
        scrollable: find.byType(Scrollable).first);
    await tester.enterText(rate, '1,250.50');
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    final after = await mine();
    expect(after.length, before + 1);
    expect(after.map((l) => l.offeredRate?.amountMinor), contains(125050));
  });

  testWidgets('QA-040 transporter home has no shipper compare hint',
      (tester) async {
    for (final email in ['transporter@truber.zw', 'kariba@truber.zw']) {
      final banned = email.startsWith('kariba');
      await tester.pumpWidget(const SizedBox());
      final s = _session();
      await s.login(email, 'demopass');
      await tester.pumpWidget(_host(s, const TransporterHome()));
      await tester.pumpAndSettle();
      expect(find.text(TruberCopy.quoteCompareHint), findsNothing,
          reason: email);
      expect(find.text(TruberCopy.transporterHomeHint),
          banned ? findsNothing : findsOneWidget,
          reason: '$email: hint hidden while banned');
      expect(find.byKey(const Key('ban_banner')),
          banned ? findsOneWidget : findsNothing,
          reason: email);
    }
  });

  testWidgets('user-banned transporter: user-ban banner, hint hidden',
      (tester) async {
    final s = _session();
    await s.login('banned.transporter@truber.zw', 'demopass');
    expect(s.ban!.userBanned, isTrue);
    expect(s.ban!.companyBanned, isFalse);
    await tester.pumpWidget(_host(s, const TransporterHome()));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ban_banner')), findsOneWidget);
    final date = formatDisplayDate(seedBanEndsAt.toLocal());
    expect(find.text(TruberCopy.banBannerBodyFor(date)), findsOneWidget);
    expect(find.text(TruberCopy.banBannerCompanyBodyFor(date)), findsNothing);
    expect(find.text(TruberCopy.transporterHomeHint), findsNothing);
    expect(find.byKey(const Key('transporter_home_hint')), findsNothing);
  });
}

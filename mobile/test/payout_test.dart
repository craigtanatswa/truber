import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/live/live_payout_repository.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_payout_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/repositories/payout_repository.dart';
import 'package:truber_app/models/booking.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/models/payout.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_app/ui/screens/transporter/transporter_home.dart';
import 'package:truber_app/ui/widgets/payout_summary.dart';
import 'package:truber_design/truber_design.dart';

Widget _wrap(Widget child, {Brightness brightness = Brightness.light}) =>
    MaterialApp(
      theme: brightness == Brightness.light
          ? TruberTheme.light()
          : TruberTheme.dark(),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

TransporterPayout _payout({
  int fees = 1250,
  PaymentMethod method = PaymentMethod.escrow,
  ProtectionStatus protection = ProtectionStatus.protected,
  bool withRelease = true,
  int? releaseBps = 500,
  int? bookingBps = 500,
  CompletionStatus completion = CompletionStatus.completed,
  ReleaseStatus releaseStatus = ReleaseStatus.releasedRecorded,
  bool? shipperPaid,
}) =>
    TransporterPayout(
      completionStatus: completion,
      releaseStatus: releaseStatus,
      shipperPaymentRecorded: shipperPaid,
      bookingId: 'b1',
      routeLabel: 'A → B',
      method: method,
      protectionStatus: protection,
      bookingCommissionRateBps: bookingBps,
      release: withRelease
          ? PaymentReleaseRecord(
              id: 'r1',
              arrangementId: 'a1',
              tripAmount:
                  const MoneyAmount(amountMinor: 95000, currency: 'USD'),
              commissionAmount:
                  const MoneyAmount(amountMinor: 4750, currency: 'USD'),
              commissionRateBps: releaseBps,
              processingFeesTotal:
                  MoneyAmount(amountMinor: fees, currency: 'USD'),
              transporterNetAmount: MoneyAmount(
                  amountMinor: 95000 - 4750 - fees, currency: 'USD'),
            )
          : null,
    );

class _NullPreview implements PayoutRepository {
  @override
  Future<List<TransporterPayout>> forTransporterCompany(String c) async =>
      const [];
  @override
  Future<MoneyAmount?> quoteNetPreview(String l, MoneyAmount a) async => null;
}

SessionController _session(PayoutRepository? payouts) {
  final loads = MockLoadRepository();
  return SessionController(
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
    payouts: payouts,
    enforceSessionExpiry: false,
  );
}

void main() {
  test('bps formatting only (no amounts derived)', () {
    expect(formatBpsAsPercent(500), '5');
    expect(formatBpsAsPercent(250), '2.5');
    expect(formatBpsAsPercent(1234), '12.34');
  });

  testWidgets('bold net line, toggle reveals breakdown with deductions',
      (tester) async {
    await tester.pumpWidget(_wrap(PayoutSummary(payout: _payout())));
    expect(find.text('You receive'), findsOneWidget);
    expect(find.text('US\$890.00'), findsOneWidget);
    final net = tester.widget<Text>(find.text('US\$890.00'));
    expect(net.style?.fontWeight, FontWeight.w700);
    expect(find.byKey(const Key('payout_breakdown')), findsNothing);

    await tester.tap(find.byKey(const Key('payout_breakdown_toggle')));
    await tester.pump();
    expect(find.text('Agreed price'), findsOneWidget);
    expect(find.text('US\$950.00'), findsOneWidget);
    expect(find.text('Truber commission (5%)'), findsOneWidget);
    expect(find.text('\u2013 US\$47.50'), findsOneWidget);
    expect(find.text('Payment fees'), findsOneWidget);
    expect(find.text('\u2013 US\$12.50'), findsOneWidget);
    expect(find.text('You receive'), findsNWidgets(2));
    expect(find.text(TruberCopy.payoutHelperProtected), findsOneWidget);
  });

  testWidgets('fees row hidden when zero', (tester) async {
    await tester.pumpWidget(_wrap(
        PayoutSummary(payout: _payout(fees: 0), initiallyExpanded: true)));
    expect(find.byKey(const Key('payout_fees_row')), findsNothing);
    expect(find.text('Payment fees'), findsNothing);
    expect(find.text('US\$902.50'), findsNWidgets(2));
  });

  testWidgets('rate from booking when release omits it; hidden when neither',
      (tester) async {
    await tester.pumpWidget(_wrap(PayoutSummary(
        payout: _payout(releaseBps: null, bookingBps: 500),
        initiallyExpanded: true)));
    expect(find.text('Truber commission (5%)'), findsOneWidget);
    await tester.pumpWidget(_wrap(
        PayoutSummary(payout: _payout(releaseBps: null, bookingBps: null))));
    expect(find.byKey(const Key('payout_net_line')), findsNothing);
  });

  testWidgets('no release record: payout line hidden, never computed',
      (tester) async {
    await tester
        .pumpWidget(_wrap(PayoutSummary(payout: _payout(withRelease: false))));
    expect(find.byKey(const Key('payout_net_line')), findsNothing);
    expect(find.textContaining('US\$'), findsNothing);
  });

  testWidgets('cash shows cash helper; unprotected non-cash shows none',
      (tester) async {
    await tester.pumpWidget(_wrap(PayoutSummary(
        payout: _payout(
            withRelease: false,
            method: PaymentMethod.cash,
            protection: ProtectionStatus.none))));
    expect(find.text(TruberCopy.payoutHelperCash), findsOneWidget);
    expect(find.text(TruberCopy.payoutHelperProtected), findsNothing);

    await tester.pumpWidget(_wrap(PayoutSummary(
        payout: _payout(
            method: PaymentMethod.prepay, protection: ProtectionStatus.none))));
    expect(find.byKey(const Key('payout_helper')), findsNothing);
  });

  testWidgets('transporter home lists mock payouts; live shows none',
      (tester) async {
    final s = _session(MockPayoutRepository());
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(ChangeNotifierProvider.value(
        value: s,
        child: _wrap(const SizedBox(height: 1200, child: TransporterHome()))));
    await tester.pumpAndSettle();
    expect(find.byType(PayoutCard),
        findsNWidgets(seedTransporterPayouts().length));

    await tester.pumpWidget(const SizedBox());
    final live = _session(LivePayoutRepository());
    await live.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(ChangeNotifierProvider.value(
        value: live,
        child: _wrap(const SizedBox(height: 1200, child: TransporterHome()))));
    await tester.pumpAndSettle();
    expect(find.byType(PayoutCard), findsNothing);
  });

  testWidgets('quote hint shows server/mock net; hidden when API has none',
      (tester) async {
    final load = seedLoads().first;
    final s = _session(MockPayoutRepository());
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(ChangeNotifierProvider.value(
        value: s, child: MaterialApp(home: SubmitQuoteScreen(load: load))));
    await tester.enterText(find.byKey(const Key('quote_rate')), '950');
    await tester.pumpAndSettle();
    expect(find.text('You’ll receive US\$902.50 after commission and fees.'),
        findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    final n = _session(_NullPreview());
    await n.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(ChangeNotifierProvider.value(
        value: n, child: MaterialApp(home: SubmitQuoteScreen(load: load))));
    await tester.enterText(find.byKey(const Key('quote_rate')), '950');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('quote_payout_hint')), findsNothing);
  });

  test('mock payout examples are internally consistent (spec formula)', () {
    for (final p in seedTransporterPayouts()) {
      final r = p.release;
      if (r == null) continue;
      expect(
          r.tripAmount.amountMinor -
              r.commissionAmount.amountMinor -
              (r.processingFeesTotal?.amountMinor ?? 0),
          r.transporterNetAmount.amountMinor);
    }
  });
}

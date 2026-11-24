import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_company_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/quotation.dart';
import 'package:truber_app/models/user.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/screens/shipper/booking_confirm_screen.dart';
import 'package:truber_app/ui/screens/shipper/quotations_screen.dart';
import 'package:truber_app/ui/screens/transporter/my_quotes_screen.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_app/ui/widgets/quote_payout_hint.dart';
import 'package:truber_design/truber_design.dart';

SessionController _session() {
  final loads = MockLoadRepository();
  return SessionController(
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
    companyDirectory: MockCompanyRepository(),
    enforceSessionExpiry: false,
  );
}

Widget _host(SessionController session, Widget child) =>
    ChangeNotifierProvider.value(
      value: session,
      child: MaterialApp(theme: TruberAppTheme.light(), home: child),
    );

void _surface(WidgetTester tester) {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void _resetStore() {
  final store = MockStores.instance;
  store.quotations
    ..clear()
    ..addAll(seedQuotations());
  store.bookings.clear();
}

/// Payout and protection wording that must never appear for a shipper.
void _expectNoPayoutCopy(WidgetTester tester) {
  for (final phrase in [
    'You’ll earn',
    'You receive',
    'Truber commission',
    'See breakdown',
    'Payment fees',
    'Payment protected',
    'Not protected',
    'after Truber',
    'commission',
  ]) {
    expect(find.textContaining(phrase), findsNothing, reason: phrase);
  }
}

void main() {
  setUp(_resetStore);

  testWidgets('shipper compares quotes and confirms before accept',
      (tester) async {
    _surface(tester);
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, QuotationsScreen(load: seedLoads().first)));
    await tester.pumpAndSettle();

    expect(find.text(TruberCopy.quoteCompareHint), findsOneWidget);
    expect(find.textContaining('US\$950.00'), findsOneWidget);
    expect(find.textContaining('US\$980.00'), findsOneWidget);
    expect(find.textContaining('US\$900.00'), findsOneWidget);
    expect(find.text('Ncube Haulage'), findsWidgets);
    expect(find.text('Kariba Freight'), findsOneWidget);

    await tester.tap(find.byKey(const Key('select_quote_${MockIds.quote1}')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('accept_confirm_dialog')), findsOneWidget);
    expect(find.textContaining('US\$950.00'), findsWidgets);
    _expectNoPayoutCopy(tester);

    await tester.tap(find.byKey(const Key('accept_confirm_cancel')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('accept_confirm_dialog')), findsNothing);
    expect(
      MockStores.instance.quotations
          .firstWhere((q) => q.id == MockIds.quote1)
          .status,
      QuotationStatus.submitted,
    );

    await tester.tap(find.byKey(const Key('select_quote_${MockIds.quote1}')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('accept_confirm')));
    await tester.pumpAndSettle();

    expect(find.byType(BookingConfirmScreen), findsOneWidget);
    expect(
      MockStores.instance.quotations
          .firstWhere((q) => q.id == MockIds.quote1)
          .status,
      QuotationStatus.accepted,
    );
    expect(
      MockStores.instance.quotations
          .firstWhere((q) => q.id == MockIds.quote2)
          .status,
      QuotationStatus.notSelected,
    );
  });

  testWidgets('shipper never sees payout or protection wording', (tester) async {
    _surface(tester);
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, QuotationsScreen(load: seedLoads().first)));
    await tester.pumpAndSettle();
    _expectNoPayoutCopy(tester);
    expect(find.byKey(const Key('quote_payout_hint')), findsNothing);

    await tester.pumpWidget(_host(
      s,
      const QuotePayoutHint(
        role: UserRole.shipper,
        net: MoneyAmount(amountMinor: 90250, currency: 'USD'),
      ),
    ));
    await tester.pumpAndSettle();
    _expectNoPayoutCopy(tester);
    expect(find.byKey(const Key('quote_payout_hint')), findsNothing);

    await tester.pumpWidget(_host(
      s,
      const Scaffold(
        body: QuotePayoutHint(
          role: UserRole.transporter,
          net: MoneyAmount(amountMinor: 90250, currency: 'USD'),
        ),
      ),
    ));
    await tester.pump();
    expect(
      find.text('You’ll earn US\$902.50 after Truber’s commission.'),
      findsOneWidget,
    );
  });

  testWidgets('shipper can restore not-selected quotes', (tester) async {
    _surface(tester);
    final store = MockStores.instance;
    final i = store.quotations.indexWhere((q) => q.id == MockIds.quote2);
    store.quotations[i] =
        store.quotations[i].copyWith(status: QuotationStatus.notSelected);
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, QuotationsScreen(load: seedLoads().first)));
    await tester.pumpAndSettle();
    _expectNoPayoutCopy(tester);
    await tester.tap(find.byKey(const Key('restore_not_selected')));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text(TruberCopy.quoteRestored), findsOneWidget);
    expect(
      store.quotations.firstWhere((q) => q.id == MockIds.quote2).status,
      QuotationStatus.submitted,
    );
    expect(find.byKey(const Key('restore_not_selected')), findsNothing);
  });

  testWidgets('transporter submit shows net hint and no breakdown',
      (tester) async {
    _surface(tester);
    final s = _session();
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(
        _host(s, SubmitQuoteScreen(load: seedLoads().first)));
    await tester.enterText(find.byKey(const Key('quote_rate')), '1000');
    await tester.pumpAndSettle();
    expect(
      find.text('You’ll earn US\$950.00 after Truber’s commission.'),
      findsOneWidget,
    );
    expect(find.textContaining('US\$50.00'), findsNothing);
    expect(find.textContaining('Payment protected'), findsNothing);
    expect(find.textContaining('Not protected'), findsNothing);
    expect(find.textContaining('You receive'), findsNothing);
    expect(find.textContaining('See breakdown'), findsNothing);
    expect(find.textContaining('Truber commission ('), findsNothing);

    final before = MockStores.instance.quotations.length;
    await tester.tap(find.byKey(const Key('quote_submit')));
    await tester.pumpAndSettle();
    expect(MockStores.instance.quotations.length, before + 1);
    expect(
      MockStores.instance.quotations.last.amount.amountMinor,
      100000,
    );
    expect(
      MockStores.instance.quotations.last.status,
      QuotationStatus.submitted,
    );
  });

  testWidgets('shipper on the submit screen still sees no payout hint',
      (tester) async {
    _surface(tester);
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(
        _host(s, SubmitQuoteScreen(load: seedLoads().first)));
    await tester.enterText(find.byKey(const Key('quote_rate')), '1000');
    await tester.pumpAndSettle();
    _expectNoPayoutCopy(tester);
  });

  testWidgets('dark theme card border and withdraw label use dark tokens',
      (tester) async {
    tester.view.physicalSize = const Size(420, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final s = _session();
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: s,
      child: MaterialApp(
        theme: TruberAppTheme.dark(),
        home: TransporterQuotesScreen(load: seedLoads().first),
      ),
    ));
    await tester.pumpAndSettle();

    final cardMaterial = tester.widget<Material>(find
        .descendant(
          of: find.byType(Card).first,
          matching: find.byType(Material),
        )
        .first);
    expect(
      (cardMaterial.shape! as RoundedRectangleBorder).side.color,
      TruberColors.borderDark,
    );

    final button = find.byKey(const Key('withdraw_quote_${MockIds.quote1}'));
    final states = <WidgetState>{};
    final theme = Theme.of(tester.element(button));
    final foreground = button.evaluate().single.widget is OutlinedButton
        ? (tester.widget<OutlinedButton>(button).style?.foregroundColor ??
                theme.outlinedButtonTheme.style?.foregroundColor)
            ?.resolve(states)
        : null;
    expect(foreground, TruberColors.primaryTextDark);
    final side = (tester.widget<OutlinedButton>(button).style?.side ??
            theme.outlinedButtonTheme.style?.side)
        ?.resolve(states);
    expect(side?.color, TruberColors.borderStrongDark);

    final label = tester.widget<RichText>(find.descendant(
      of: button,
      matching: find.byType(RichText),
    ));
    expect(label.text.style?.color, TruberColors.primaryTextDark);

    final edge = tester.getTopLeft(find.byType(Card).first) + const Offset(0, 24);
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byType(RepaintBoundary).first,
    );
    final image = (await tester.runAsync(() => boundary.toImage()))!;
    final bytes = (await tester.runAsync(
      () => image.toByteData(format: ui.ImageByteFormat.rawRgba),
    ))!;
    final x = edge.dx.round();
    final y = edge.dy.round();
    final i = (y * image.width + x) * 4;
    final painted = Color.fromARGB(
      bytes.getUint8(i + 3),
      bytes.getUint8(i),
      bytes.getUint8(i + 1),
      bytes.getUint8(i + 2),
    );
    expect(painted, TruberColors.borderDark, reason: 'pixel $x,$y');
  });

  testWidgets('transporter lists own quotes and withdraws one', (tester) async {
    _surface(tester);
    final s = _session();
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(
        _host(s, TransporterQuotesScreen(load: seedLoads().first)));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.navQuotes), findsOneWidget);
    final withdraw = find.byKey(const Key('withdraw_quote_${MockIds.quote1}'));
    expect(tester.widget(withdraw), isA<OutlinedButton>());
    expect(tester.getSize(withdraw).height, TruberTouch.minButtonSize.height);
    expect(find.byKey(const Key('withdraw_quote_${MockIds.quote2}')),
        findsOneWidget);
    expect(find.text('Kariba Freight'), findsNothing);
    expect(find.textContaining('US\$900.00'), findsNothing);
    expect(find.textContaining('Payment protected'), findsNothing);
    expect(find.textContaining('Not protected'), findsNothing);

    await tester.tap(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('withdraw_confirm_dialog')), findsOneWidget);
    expect(find.text(TruberCopy.quoteWithdrawConfirmTitle), findsOneWidget);
    expect(find.text(TruberCopy.quoteWithdrawConfirmBody), findsOneWidget);
    final confirm = tester.widget<ElevatedButton>(
        find.byKey(const Key('withdraw_confirm')));
    expect(
      confirm.style?.backgroundColor?.resolve(const <WidgetState>{}),
      TruberColors.error,
    );

    await tester.tap(find.byKey(const Key('withdraw_confirm_cancel')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('withdraw_confirm_dialog')), findsNothing);
    expect(find.text(TruberCopy.quoteWithdrawn), findsNothing);
    expect(
      MockStores.instance.quotations
          .firstWhere((q) => q.id == MockIds.quote1)
          .status,
      QuotationStatus.submitted,
    );

    await tester.tap(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('withdraw_confirm')));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.quoteWithdrawn), findsOneWidget);
    expect(find.text(TruberCopy.statusQuotationWithdrawn), findsOneWidget);
    expect(
      MockStores.instance.quotations
          .firstWhere((q) => q.id == MockIds.quote1)
          .status,
      QuotationStatus.withdrawn,
    );
    expect(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')),
        findsNothing);
  });

  testWidgets('preview blockers use existing copy and hide owing amounts',
      (tester) async {
    _surface(tester);
    final loads = MockLoadRepository();
    final quotes = _BlockerPreview(loads: loads);
    final s = SessionController(
      auth: MockAuthRepository(),
      loads: loads,
      quotations: quotes,
      bookings: MockBookingRepository(),
      payments: MockPaymentRepository(),
      enforceSessionExpiry: false,
    );
    await s.login('transporter@truber.zw', 'demopass');
    await tester
        .pumpWidget(_host(s, SubmitQuoteScreen(load: seedLoads().first)));
    await tester.enterText(find.byKey(const Key('quote_rate')), '250.10');
    await tester.pumpAndSettle();
    expect(
      find.text('You’ll earn US\$237.59 after Truber’s commission.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('quote_submission_blocker_ACCOUNT_BANNED')),
        findsOneWidget);
    expect(
        find.byKey(const Key('quote_submission_blocker_COMMISSION_OUTSTANDING')),
        findsOneWidget);
    expect(find.text(TruberCopy.errorValidation), findsOneWidget);
    expect(find.textContaining('US\$12.51'), findsNothing);
    expect(find.textContaining('US\$15.00'), findsNothing);
    expect(find.textContaining('1500'), findsNothing);
    expect(find.textContaining('Payment protected'), findsNothing);
    expect(find.textContaining('Not protected'), findsNothing);
  });
}

class _BlockerPreview extends MockQuotationRepository {
  _BlockerPreview({required super.loads});

  @override
  Future<PayoutPreview> previewPayout(PayoutPreviewRequest request) async {
    return PayoutPreview(
      agreedAmount: request.amount,
      commissionRateBps: 500,
      commissionAmount:
          const MoneyAmount(amountMinor: 1251, currency: 'USD'),
      knownFeesTotal: const MoneyAmount(amountMinor: 0, currency: 'USD'),
      netPayoutBeforeUnknownFees:
          const MoneyAmount(amountMinor: 23759, currency: 'USD'),
      feeStatus: 'unknown',
      paymentMethod: 'escrow',
      farePayoutDueThroughTruber: true,
      paymentProtectedPossible: true,
      submissionBlockers: [
        SubmissionBlocker(
          code: 'ACCOUNT_BANNED',
          bannedUntil: DateTime.utc(2026, 11, 24, 9),
        ),
        const SubmissionBlocker(code: 'COMMISSION_OUTSTANDING'),
      ],
    );
  }
}

// Renders launch-review screenshots with real glyphs.
// Not under test/, so `flutter test` does not run it.
//
//   flutter test tool/launch_shots_test.dart \
//     --dart-define=SUPPORT_EMAIL=support@truber.example
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_company_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_payout_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/models/booking.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/models/payout.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/state/theme_controller.dart';
import 'package:truber_app/ui/screens/auth/register_screen.dart';
import 'package:truber_app/ui/widgets/ban_banner.dart';
import 'package:truber_app/ui/screens/auth/verify_phone_screen.dart';
import 'package:truber_app/ui/screens/shell/admin_shell.dart';
import 'package:truber_app/ui/screens/shipper/booking_confirm_screen.dart';
import 'package:truber_app/ui/screens/shipper/payment_choice_screen.dart';
import 'package:truber_app/ui/screens/transporter/transporter_booking_screen.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_design/truber_design.dart';

Future<ByteData> _fileFont(String name) async {
  final root = Platform.environment['FLUTTER_ROOT'] ??
      '${Platform.environment['HOME']}/sdk/flutter';
  final bytes = await File(
    '$root/bin/cache/artifacts/material_fonts/$name',
  ).readAsBytes();
  return ByteData.sublistView(Uint8List.fromList(bytes));
}

Future<void> _loadFonts() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final roboto = FontLoader('Roboto')
    ..addFont(_fileFont('Roboto-Regular.ttf'))
    ..addFont(_fileFont('Roboto-Medium.ttf'))
    ..addFont(_fileFont('Roboto-Bold.ttf'));
  await roboto.load();
  final icons = FontLoader('MaterialIcons')
    ..addFont(_fileFont('MaterialIcons-Regular.otf'));
  await icons.load();
}

ThemeData _theme(bool dark) {
  final base = dark
      ? TruberTheme.dark(fontFamily: 'Roboto')
      : TruberTheme.light(fontFamily: 'Roboto');
  final palette =
      dark ? TruberPrimaryButtonPalette.dark : TruberPrimaryButtonPalette.light;
  final style = TruberAppTheme.primaryStyle(palette, base.textTheme);
  return base.copyWith(
    elevatedButtonTheme: ElevatedButtonThemeData(style: style),
    filledButtonTheme: FilledButtonThemeData(style: style),
  );
}

SessionController _session() {
  MockStores.instance.quotations
    ..clear()
    ..addAll(seedQuotations());
  MockStores.instance.bookings.clear();
  MockStores.instance.arrangements.clear();
  MockStores.instance.autoConfirmArrangements = true;
  final loads = MockLoadRepository();
  return SessionController(
    enforceSessionExpiry: false,
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
    payouts: MockPayoutRepository(),
    companyDirectory: MockCompanyRepository(),
    clock: DateTime.now,
  );
}

Widget _host(Widget home, {required SessionController session, bool dark = false}) {
  return ChangeNotifierProvider.value(
    value: session,
    child: ChangeNotifierProvider(
      create: (_) => ThemeController(),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: _theme(false),
        darkTheme: _theme(true),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        home: home,
      ),
    ),
  );
}

Future<void> _frames(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _save(WidgetTester tester, String name) async {
  await _frames(tester);
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('shots/$name.png'),
  );
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('launch review screenshots', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final admin = _session();
    await admin.login('admin@truber.zw', 'demopass');
    await tester.pumpWidget(_host(const AdminShell(), session: admin));
    expect(find.text(TruberCopy.adminHomeBody), findsOneWidget);
    expect(find.text('DEBUG'), findsNothing);
    await _save(tester, 'admin_home');

    Future<void> payment(String name, {required bool dark}) async {
      final s = _session();
      await s.login('shipper@truber.zw', 'demopass');
      final load = await s.loads.getById(MockIds.load1);
      final accepted = await s.quotations.accept(MockIds.quote1);
      await tester.pumpWidget(_host(
        PaymentChoiceScreen(booking: accepted.booking, load: load),
        session: s,
        dark: dark,
      ));
      expect(find.text(TruberCopy.payCash), findsOneWidget);
      expect(find.text(TruberCopy.payBankTransfer), findsOneWidget);
      expect(find.text(TruberCopy.payCommissionNote), findsNothing);
      await _save(tester, name);
    }

    await payment('payment_choice', dark: false);
    await payment('payment_choice_dark', dark: true);

    Future<void> bookingShot(String name, PaymentMethod method) async {
      final s = _session();
      await s.login('shipper@truber.zw', 'demopass');
      final load = await s.loads.getById(MockIds.load1);
      final accepted = await s.quotations.accept(MockIds.quote1);
      await s.payments.propose(
        accepted.booking.id,
        CreatePaymentArrangementRequest(
          method: method,
          totalAmount: accepted.booking.agreedAmount,
        ),
      );
      await tester.pumpWidget(_host(
        BookingConfirmScreen(
          key: ValueKey(name),
          load: load,
          booking: accepted.booking,
          quotation: accepted.quotation,
        ),
        session: s,
      ));
      await _frames(tester);
      final status = method == PaymentMethod.cash
          ? TruberCopy.payStatusCashRecorded
          : TruberCopy.payStatusBankTransferRecorded;
      expect(find.text(status), findsOneWidget);
      expect(find.text(TruberCopy.payCommissionNote), findsNothing);
      expect(find.text(TruberCopy.payoutNetLabel), findsNothing);
      await tester.ensureVisible(find.text(status));
      await _frames(tester);
      await _save(tester, name);
    }

    await bookingShot('cash_recorded', PaymentMethod.cash);
    await bookingShot('transfer_recorded', PaymentMethod.directTransfer);
    await bookingShot('shipper_no_commission', PaymentMethod.cash);

    final reg = _session();
    await tester.pumpWidget(_host(const RegisterScreen(), session: reg));
    await _frames(tester);
    await tester.tap(find.byKey(const Key('register_role_shipper')));
    await _frames(tester);
    expect(find.text(TruberCopy.termsNotice), findsOneWidget);
    expect(find.text(TruberCopy.registerCta), findsOneWidget);
    await tester.ensureVisible(find.text(TruberCopy.termsNotice));
    await _frames(tester);
    await _save(tester, 'register_terms');

    final banned = _session();
    await banned.login('banned.shipper@truber.zw', 'demopass');
    expect(banned.ban, isNotNull);
    await tester.pumpWidget(_host(
      const Scaffold(
        body: Padding(
          padding: EdgeInsets.all(16),
          child: Align(
            alignment: Alignment.topCenter,
            child: BanBannerHost(),
          ),
        ),
      ),
      session: banned,
    ));
    expect(find.text(TruberCopy.banCtaHelp), findsOneWidget);
    expect(find.text(TruberCopy.banBannerTitle), findsOneWidget);
    await _save(tester, 'ban_email_support');

    const payout = TransporterPayout(
      bookingId: 'b1',
      routeLabel: 'Harare → Bulawayo',
      method: PaymentMethod.cash,
      protectionStatus: ProtectionStatus.none,
      completionStatus: CompletionStatus.completed,
      releaseStatus: ReleaseStatus.notApplicable,
      bookingCommissionRateBps: 500,
      release: PaymentReleaseRecord(
        id: 'r1',
        arrangementId: 'a1',
        tripAmount: MoneyAmount(amountMinor: 95000, currency: 'USD'),
        commissionAmount: MoneyAmount(amountMinor: 4750, currency: 'USD'),
        commissionRateBps: 500,
        transporterNetAmount: MoneyAmount(amountMinor: 90250, currency: 'USD'),
      ),
    );

    Future<void> payoutShot(String name, {required bool dark}) async {
      final s = _session();
      await s.login('transporter@truber.zw', 'demopass');
      await tester.pumpWidget(_host(
        const TransporterBookingScreen(payout: payout),
        session: s,
        dark: dark,
      ));
      expect(find.text(TruberCopy.payCommissionNote), findsOneWidget);
      expect(find.text(TruberCopy.payoutNetLabel), findsWidgets);
      await _save(tester, name);
    }

    await payoutShot('payout_commission', dark: false);
    await payoutShot('payout_commission_dark', dark: true);

    final verify = _session();
    await verify.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_host(const VerifyPhoneScreen(), session: verify));
    await _frames(tester);
    expect(find.text(TruberCopy.otpTitle), findsWidgets);
    expect(find.text(TruberCopy.verifyDemoHint), findsNothing);
    expect(find.textContaining('Demo code'), findsNothing);
    await _save(tester, 'verify_no_demo_hint');
  });
}

/// Uses the production [BanBanner] once SUPPORT_EMAIL is compiled in.
class BanBannerHost extends StatelessWidget {
  const BanBannerHost({super.key});

  @override
  Widget build(BuildContext context) {
    return const BanBanner();
  }
}

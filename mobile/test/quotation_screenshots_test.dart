import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_company_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/screens/shipper/quotations_screen.dart';
import 'package:truber_app/ui/screens/transporter/my_quotes_screen.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_design/truber_design.dart';

/// Local-only capture. Not part of CI: golden pixels depend on the host fonts.
/// Run: flutter test test/quotation_screenshots_test.dart --update-goldens
SessionController _session() {
  MockStores.instance.quotations
    ..clear()
    ..addAll(seedQuotations());
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

Future<ByteData> _bytes(String path) async {
  final bytes = await File(path).readAsBytes();
  return ByteData.view(Uint8List.fromList(bytes).buffer);
}

Future<void> _loadFonts() async {
  final roboto = FontLoader('Roboto');
  const dir =
      '/opt/flutter/bin/cache/dart-sdk/bin/resources/devtools/assets/fonts/Roboto';
  for (final file in [
    'Roboto-Regular.ttf',
    'Roboto-Medium.ttf',
    'Roboto-Bold.ttf',
    'Roboto-Black.ttf',
  ]) {
    roboto.addFont(_bytes('$dir/$file'));
  }
  await roboto.load();
  final icons = FontLoader('MaterialIcons');
  icons.addFont(_bytes(
      '/opt/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

/// Font only. Colours, including outlined-button foreground and side, stay
/// on the theme so dark captures keep primaryTextDark and borderStrongDark.
ButtonStyle? _robotoButtons(ButtonStyle? style) {
  if (style == null) return null;
  return style.copyWith(
    textStyle: WidgetStateProperty.resolveWith((states) {
      final current = style.textStyle?.resolve(states);
      return (current ?? const TextStyle()).copyWith(fontFamily: 'Roboto');
    }),
  );
}

TextTheme _robotoText(TextTheme theme) => theme.apply(fontFamily: 'Roboto');

ThemeData _theme([Brightness brightness = Brightness.light]) {
  final base = brightness == Brightness.dark
      ? TruberAppTheme.dark()
      : TruberAppTheme.light();
  return base.copyWith(
    textTheme: _robotoText(base.textTheme),
    primaryTextTheme: _robotoText(base.primaryTextTheme),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: _robotoButtons(base.outlinedButtonTheme.style),
    ),
    textButtonTheme: TextButtonThemeData(
      style: _robotoButtons(base.textButtonTheme.style),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: _robotoButtons(base.elevatedButtonTheme.style),
    ),
  );
}

Future<void> _pump(
  WidgetTester tester,
  SessionController session,
  Widget home, {
  Brightness brightness = Brightness.light,
}) {
  return tester.pumpWidget(RepaintBoundary(
    key: const Key('shot'),
    child: ChangeNotifierProvider.value(
      value: session,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: _theme(Brightness.light),
        darkTheme: _theme(Brightness.dark),
        themeMode: brightness == Brightness.dark
            ? ThemeMode.dark
            : ThemeMode.light,
        home: home,
      ),
    ),
  ));
}

void main() {
  testWidgets('quotation screenshots', (tester) async {
    await tester.runAsync(_loadFonts);
    tester.view.physicalSize = const Size(420, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final shipper = _session();
    await shipper.login('shipper@truber.zw', 'demopass');
    await _pump(tester, shipper, QuotationsScreen(load: seedLoads().first));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Ncube Haulage'), findsWidgets);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/shipper_quotation_list.png'));

    await tester.tap(find.byKey(const Key('select_quote_${MockIds.quote1}')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('accept_confirm_dialog')), findsOneWidget);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/shipper_accept_confirmation.png'));
    await tester.tap(find.byKey(const Key('accept_confirm_cancel')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    final transporter = _session();
    await transporter.login('transporter@truber.zw', 'demopass');
    await _pump(
        tester, transporter, SubmitQuoteScreen(load: seedLoads().first));
    await tester.enterText(find.byKey(const Key('quote_rate')), '1000');
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const Key('quote_payout_hint')), findsOneWidget);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_submit_payout_preview.png'));

    await _pump(
        tester, transporter, TransporterQuotesScreen(load: seedLoads().first));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Withdraw quotation'), findsWidgets);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_quotes_withdraw.png'));

    await tester.tap(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('withdraw_confirm_dialog')), findsOneWidget);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_withdraw_dialog.png'));
    await tester.tap(find.byKey(const Key('withdraw_confirm_cancel')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await _pump(
      tester,
      transporter,
      TransporterQuotesScreen(load: seedLoads().first),
      brightness: Brightness.dark,
    );
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Withdraw quotation'), findsWidgets);
    final darkButton = find.byKey(const Key('withdraw_quote_${MockIds.quote1}'));
    final darkStates = <WidgetState>{};
    final darkTheme = Theme.of(tester.element(darkButton));
    final darkFg = (tester.widget<OutlinedButton>(darkButton).style?.foregroundColor ??
            darkTheme.outlinedButtonTheme.style?.foregroundColor)
        ?.resolve(darkStates);
    expect(darkFg, TruberColors.primaryTextDark);
    final darkCard = tester.widget<Material>(find
        .descendant(of: find.byType(Card).first, matching: find.byType(Material))
        .first);
    expect(
      (darkCard.shape! as RoundedRectangleBorder).side.color,
      TruberColors.borderDark,
    );
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_quotes_withdraw_dark.png'));

    await tester.tap(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('withdraw_confirm_dialog')), findsOneWidget);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_withdraw_dialog_dark.png'));
  }, skip: !const bool.fromEnvironment('QUOTATION_SHOTS'));
}

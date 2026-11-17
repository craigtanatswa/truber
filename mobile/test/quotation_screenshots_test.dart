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

TextStyle? _face(TextStyle? style, FontWeight weight) =>
    style?.copyWith(fontFamily: 'Roboto', fontWeight: weight);

/// Only Regular (400) and Bold (700) are loaded. Other weights fall back to
/// the test font, which draws black boxes.
TextTheme _faces(TextTheme theme) => theme.copyWith(
      displaySmall: _face(theme.displaySmall, FontWeight.w700),
      headlineSmall: _face(theme.headlineSmall, FontWeight.w700),
      headlineMedium: _face(theme.headlineMedium, FontWeight.w700),
      titleLarge: _face(theme.titleLarge, FontWeight.w700),
      titleMedium: _face(theme.titleMedium, FontWeight.w700),
      titleSmall: _face(theme.titleSmall, FontWeight.w700),
      bodyLarge: _face(theme.bodyLarge, FontWeight.w400),
      bodyMedium: _face(theme.bodyMedium, FontWeight.w400),
      bodySmall: _face(theme.bodySmall, FontWeight.w400),
      labelLarge: _face(theme.labelLarge, FontWeight.w700),
      labelMedium: _face(theme.labelMedium, FontWeight.w700),
      labelSmall: _face(theme.labelSmall, FontWeight.w700),
    );

ThemeData _theme() {
  final base = TruberAppTheme.light();
  const face = TextStyle(fontFamily: 'Roboto', color: Colors.black);
  return base.copyWith(
    textTheme: _faces(base.textTheme),
    primaryTextTheme: _faces(base.primaryTextTheme),
    appBarTheme: base.appBarTheme.copyWith(
      titleTextStyle:
          face.copyWith(fontSize: 22, fontWeight: FontWeight.w700),
    ),
    dialogTheme: DialogTheme(
      titleTextStyle: face.copyWith(fontSize: 20, fontWeight: FontWeight.w700),
      contentTextStyle:
          face.copyWith(fontSize: 16, fontWeight: FontWeight.w400),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: const Color(0xFF0035FE),
        textStyle: face.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

Future<void> _pump(WidgetTester tester, SessionController session, Widget home) {
  return tester.pumpWidget(RepaintBoundary(
    key: const Key('shot'),
    child: ChangeNotifierProvider.value(
      value: session,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: _theme(),
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
    expect(find.byKey(const Key('withdraw_quote_${MockIds.quote1}')),
        findsOneWidget);
    await expectLater(find.byKey(const Key('shot')),
        matchesGoldenFile('goldens/transporter_quotes_withdraw.png'));
  }, skip: !const bool.fromEnvironment('QUOTATION_SHOTS'));
}

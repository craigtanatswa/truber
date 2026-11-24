import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/state/theme_controller.dart';
import 'package:truber_app/ui/screens/shell/account_tab.dart';
import 'package:truber_design/truber_design.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('ThemeController defaults to system and persists selection', () async {
    final prefs = await SharedPreferences.getInstance();
    final c = ThemeController(prefs: prefs);
    await c.load();
    expect(c.mode, ThemeMode.system);

    await c.setMode(ThemeMode.dark);
    expect(c.mode, ThemeMode.dark);
    expect(prefs.getString(ThemeController.prefsKey), 'dark');

    final c2 = ThemeController(prefs: prefs);
    await c2.load();
    expect(c2.mode, ThemeMode.dark);

    await c2.setMode(ThemeMode.light);
    expect(prefs.getString(ThemeController.prefsKey), 'light');
  });

  testWidgets('Account appearance control switches MaterialApp themeMode',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final themes = ThemeController(prefs: prefs);
    await themes.load();

    final loads = MockLoadRepository();
    final session = SessionController(
      enforceSessionExpiry: false,
      auth: MockAuthRepository(),
      loads: loads,
      quotations: MockQuotationRepository(loads: loads),
      bookings: MockBookingRepository(),
      payments: MockPaymentRepository(),
    );
    await session.login('shipper@truber.zw', 'demopass');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: session),
          ChangeNotifierProvider.value(value: themes),
        ],
        child: Consumer<ThemeController>(
          builder: (context, t, _) => MaterialApp(
            theme: TruberTheme.light(),
            darkTheme: TruberTheme.dark(),
            themeMode: t.mode,
            home: const AccountTab(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('theme_mode_selector')), findsOneWidget);
    expect(themes.mode, ThemeMode.system);

    await tester.tap(find.text(TruberCopy.themeDark));
    await tester.pumpAndSettle();
    expect(themes.mode, ThemeMode.dark);

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
    expect(app.darkTheme, isNotNull);
    expect(app.theme, isNotNull);

    await tester.tap(find.text(TruberCopy.themeLight));
    await tester.pumpAndSettle();
    expect(themes.mode, ThemeMode.light);
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
      ThemeMode.light,
    );
  });

  test('TruberApp exposes light and dark ThemeData factories', () {
    expect(TruberTheme.light().brightness, Brightness.light);
    expect(TruberTheme.dark().brightness, Brightness.dark);
  });
}

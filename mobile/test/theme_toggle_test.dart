import 'package:flutter/foundation.dart';
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
import 'package:truber_app/ui/screens/auth/login_screen.dart';
import 'package:truber_app/ui/screens/auth/register_screen.dart';
import 'package:truber_app/ui/screens/auth/welcome_screen.dart';
import 'package:truber_app/ui/screens/shell/account_tab.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_design/truber_design.dart';

SessionController _session() {
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

/// Same shape as TruberApp: ThemeController loads itself on creation (cold
/// start), MaterialApp follows it.
Widget _app(Widget home,
    {ThemeController? themes,
    SessionController? session,
    bool reduceMotion = false}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider.value(value: session ?? _session()),
      ChangeNotifierProvider(
          create: (_) => (themes ?? ThemeController())..load()),
    ],
    child: Consumer<ThemeController>(
      builder: (context, t, _) => MaterialApp(
        theme: TruberAppTheme.light(),
        darkTheme: TruberAppTheme.dark(),
        themeMode: t.mode,
        themeAnimationDuration: Duration.zero,
        builder: (context, child) => reduceMotion
            ? MediaQuery(
                data: MediaQuery.of(context).copyWith(disableAnimations: true),
                child: child!)
            : child!,
        home: home,
      ),
    ),
  );
}

ThemeMode _appMode(WidgetTester t) =>
    t.widget<MaterialApp>(find.byType(MaterialApp)).themeMode!;
Brightness _brightness(WidgetTester t, Finder f) =>
    Theme.of(t.element(f)).brightness;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() {
    TestWidgetsFlutterBinding.instance.platformDispatcher
        .clearPlatformBrightnessTestValue();
  });

  group('cold start loads the saved mode', () {
    for (final (saved, mode) in [
      ('system', ThemeMode.system),
      ('light', ThemeMode.light),
      ('dark', ThemeMode.dark),
    ]) {
      testWidgets('saved "$saved" → $mode', (tester) async {
        SharedPreferences.setMockInitialValues(
            {ThemeController.prefsKey: saved});
        // System brightness dark, so "system" and "dark" both resolve dark and
        // "light" proves the saved value beats the system.
        tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
        await tester.pumpWidget(_app(const WelcomeScreen()));
        await tester.pumpAndSettle();
        expect(_appMode(tester), mode);
        expect(_brightness(tester, find.byType(WelcomeScreen)),
            saved == 'light' ? Brightness.light : Brightness.dark);
      });
    }

    testWidgets('no saved value → system (first launch follows the OS)',
        (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpWidget(_app(const WelcomeScreen()));
      await tester.pumpAndSettle();
      expect(_appMode(tester), ThemeMode.system);
      expect(_brightness(tester, find.byType(WelcomeScreen)), Brightness.dark);
      expect(find.byIcon(Icons.light_mode_outlined), findsOneWidget);
    });
  });

  testWidgets('Account › Appearance SegmentedButton sets and saves each mode',
      (tester) async {
    final session = _session();
    await session.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_app(const AccountTab(), session: session));
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    expect(find.byKey(const Key('theme_mode_selector')), findsOneWidget);
    for (final (label, mode, saved) in [
      (TruberCopy.themeDark, ThemeMode.dark, 'dark'),
      (TruberCopy.themeLight, ThemeMode.light, 'light'),
      (TruberCopy.themeSystem, ThemeMode.system, 'system'),
    ]) {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
      expect(_appMode(tester), mode);
      expect(prefs.getString(ThemeController.prefsKey), saved);
    }
  });

  group('pre-sign-in theme toggle', () {
    for (final (name, screen) in [
      ('welcome', const WelcomeScreen() as Widget),
      ('login', const LoginScreen() as Widget),
      ('register', const RegisterScreen() as Widget),
    ]) {
      testWidgets('$name: light → dark → light, saved, right icon and label',
          (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue =
            Brightness.light;
        await tester.pumpWidget(_app(screen));
        await tester.pumpAndSettle();
        final prefs = await SharedPreferences.getInstance();
        final toggle = find.byKey(const Key('theme_toggle'));
        expect(toggle, findsOneWidget);
        expect(tester.getSize(toggle), const Size(48, 48));
        // Top right of the toolbar.
        final box = tester.getRect(toggle);
        expect(
            box.right,
            greaterThan(
                tester.view.physicalSize.width / tester.view.devicePixelRatio -
                    60));
        expect(box.top, lessThan(kToolbarHeight));

        expect(find.byIcon(Icons.dark_mode_outlined), findsOneWidget);
        expect(
            find.bySemanticsLabel(TruberCopy.themeSwitchDark), findsOneWidget);
        expect(find.byTooltip(TruberCopy.themeSwitchDark), findsOneWidget);
        final icon = tester.widget<Icon>(find.byIcon(Icons.dark_mode_outlined));
        expect(icon.size, 24);
        expect(icon.color, TruberColors.textSecondary);
        expect(prefs.getString(ThemeController.prefsKey), isNull);

        await tester.tap(toggle);
        await tester.pumpAndSettle();
        expect(_appMode(tester), ThemeMode.dark);
        expect(prefs.getString(ThemeController.prefsKey), 'dark');
        expect(find.byIcon(Icons.light_mode_outlined), findsOneWidget);
        expect(find.byIcon(Icons.dark_mode_outlined), findsNothing);
        expect(
            find.bySemanticsLabel(TruberCopy.themeSwitchLight), findsOneWidget);
        expect(
            tester.widget<Icon>(find.byIcon(Icons.light_mode_outlined)).color,
            TruberColors.textSecondaryDark);

        await tester.tap(toggle);
        await tester.pumpAndSettle();
        expect(_appMode(tester), ThemeMode.light);
        expect(prefs.getString(ThemeController.prefsKey), 'light');
        expect(find.byIcon(Icons.dark_mode_outlined), findsOneWidget);
      });
    }

    testWidgets('first launch on a dark system: sun icon, one tap → light',
        (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpWidget(_app(const WelcomeScreen()));
      await tester.pumpAndSettle();
      expect(
          find.bySemanticsLabel(TruberCopy.themeSwitchLight), findsOneWidget);
      await tester.tap(find.byKey(const Key('theme_toggle')));
      await tester.pumpAndSettle();
      expect(_appMode(tester), ThemeMode.light);
      expect(
          (await SharedPreferences.getInstance())
              .getString(ThemeController.prefsKey),
          'light');
    });

    testWidgets('icon swap fades over 150 ms', (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpWidget(_app(const WelcomeScreen()));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('theme_toggle')));
      await tester.pump(); // mode change
      await tester.pump(const Duration(milliseconds: 75));
      // Mid-fade: both icons are in the tree.
      expect(find.byIcon(Icons.dark_mode_outlined), findsOneWidget);
      expect(find.byIcon(Icons.light_mode_outlined), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byIcon(Icons.dark_mode_outlined), findsNothing);
    });

    testWidgets('reduced motion: icon swaps instantly', (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpWidget(_app(const WelcomeScreen(), reduceMotion: true));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('theme_toggle')));
      await tester.pump(); // mode change
      await tester.pump(); // next frame, no fade
      expect(find.byIcon(Icons.dark_mode_outlined), findsNothing);
      expect(find.byIcon(Icons.light_mode_outlined), findsOneWidget);
      final switcher = tester.widget<AnimatedSwitcher>(find.descendant(
          of: find.byKey(const Key('theme_toggle')),
          matching: find.byType(AnimatedSwitcher)));
      expect(switcher.duration, Duration.zero);
    });
  });

  group('primary button theme (blue-filled buttons only)', () {
    for (final b in Brightness.values) {
      testWidgets('${b.name}: flat, radius 8, w600, no splash, token fill',
          (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = b;
        await tester.pumpWidget(_app(const WelcomeScreen()));
        await tester.pumpAndSettle();
        final p = TruberPrimaryButtonPalette.of(b);
        final f = find.byType(ElevatedButton);
        final m = tester.widget<Material>(
            find.descendant(of: f, matching: find.byType(Material)).first);
        expect(m.elevation, 0);
        expect(m.shadowColor, Colors.transparent);
        expect((m.shape! as RoundedRectangleBorder).borderRadius,
            TruberRadii.borderLg);
        expect(TruberRadii.lg, 8);
        expect(m.textStyle!.fontWeight, FontWeight.w600);
        expect(m.color, p.primary);
        expect(p.primary, TruberColors.primary); // brand token #0035FE
        final style = Theme.of(tester.element(f)).elevatedButtonTheme.style!;
        expect(style.splashFactory, NoSplash.splashFactory);
        expect(style.backgroundColor!.resolve({WidgetState.pressed}),
            TruberPendingTokens.primaryPressed);
        expect(
            style.backgroundColor!.resolve({WidgetState.disabled}),
            b == Brightness.dark
                ? TruberColors.surfaceMutedDark
                : TruberColors.surfaceSunken);
        expect(
            style.foregroundColor!.resolve({WidgetState.disabled}),
            b == Brightness.dark
                ? TruberColors.textMutedDark
                : TruberColors.grey600);
        final ring = style.side!.resolve({WidgetState.focused})!;
        expect(ring.width, 2);
        expect(ring.color, p.focusRing);
      });
    }

    testWidgets('full-width CTAs are 52 tall and fill the form width',
        (tester) async {
      await tester.pumpWidget(_app(const LoginScreen()));
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byKey(const Key('login_submit')));
      final screenW =
          tester.view.physicalSize.width / tester.view.devicePixelRatio;
      expect(size.width, closeTo(screenW - 2 * TruberSpacing.xl, 0.5));
      expect(size.height, TruberAppTheme.fullWidthCtaHeight);
    });

    testWidgets('inline primary buttons stay 48 tall', (tester) async {
      await tester.pumpWidget(_app(const Scaffold(
          body: Center(
              child: ElevatedButton(onPressed: null, child: Text('x'))))));
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(ElevatedButton)).height, 48);
    });

    testWidgets('desktop web keeps spec heights (no compact density)',
        (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      try {
        await tester.pumpWidget(_app(const LoginScreen()));
        await tester.pumpAndSettle();
        expect(tester.getSize(find.byKey(const Key('login_submit'))).height,
            TruberAppTheme.fullWidthCtaHeight);
        await tester.pumpWidget(_app(const Scaffold(
            body: Center(
                child: ElevatedButton(onPressed: null, child: Text('x'))))));
        await tester.pumpAndSettle();
        expect(tester.getSize(find.byType(ElevatedButton)).height, 48);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });

    test('outlined, text, icon and segmented themes are untouched', () {
      for (final (app, base) in [
        (TruberAppTheme.light(), TruberTheme.light()),
        (TruberAppTheme.dark(), TruberTheme.dark()),
      ]) {
        const states = [
          <WidgetState>{},
          {WidgetState.pressed},
          {WidgetState.disabled},
          {WidgetState.selected},
          {WidgetState.hovered},
        ];
        for (final pick in <ButtonStyle? Function(ThemeData)>[
          (t) => t.outlinedButtonTheme.style,
          (t) => t.textButtonTheme.style,
          (t) => t.iconButtonTheme.style,
          (t) => t.segmentedButtonTheme.style,
        ]) {
          final a = pick(app), b = pick(base);
          expect(a == null, b == null);
          if (a == null) continue;
          for (final s in states) {
            expect(
                a.backgroundColor?.resolve(s), b!.backgroundColor?.resolve(s));
            expect(
                a.foregroundColor?.resolve(s), b.foregroundColor?.resolve(s));
            expect(a.overlayColor?.resolve(s), b.overlayColor?.resolve(s));
            expect(a.side?.resolve(s), b.side?.resolve(s));
            expect(a.shape?.resolve(s), b.shape?.resolve(s));
            expect(a.elevation?.resolve(s), b.elevation?.resolve(s));
            expect(a.minimumSize?.resolve(s), b.minimumSize?.resolve(s));
          }
        }
      }
    });
  });
}

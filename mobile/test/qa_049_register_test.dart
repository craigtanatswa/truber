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
import 'package:truber_app/models/user.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/state/theme_controller.dart';
import 'package:truber_app/ui/screens/auth/register_screen.dart';
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

Future<void> _openAccount(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(ChangeNotifierProvider(
    create: (_) => _session(),
    child: ChangeNotifierProvider(
      create: (_) => ThemeController(),
      child: MaterialApp(
        theme: TruberTheme.light(),
        home: const RegisterScreen(),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('register_role_shipper')));
  await tester.pumpAndSettle();
}

String? _error(WidgetTester tester, String key) {
  return tester
      .widget<TextField>(find.byKey(Key(key)))
      .decoration
      ?.errorText;
}

void main() {
  test('mock register rejects blank name, bad email, and short password',
      () async {
    final auth = MockAuthRepository();
    Future<void> reject({
      required String email,
      required String password,
      required String fullName,
    }) {
      return expectLater(
        auth.register(
          email: email,
          password: password,
          fullName: fullName,
          role: UserRole.shipper,
        ),
        throwsA(isA<AuthException>()),
      );
    }

    await reject(email: 'ada@example.com', password: 'demopass1', fullName: '');
    await reject(
        email: 'ada@example.com', password: 'demopass1', fullName: '   ');
    await reject(email: '', password: 'demopass1', fullName: 'Ada');
    await reject(email: 'not-an-email', password: 'demopass1', fullName: 'Ada');
    await reject(email: 'ada@example.com', password: 'short', fullName: 'Ada');

    final ok = await auth.register(
      email: 'ada@example.com',
      password: 'demopass1',
      fullName: ' Ada ',
      role: UserRole.shipper,
    );
    expect(ok.user.fullName, 'Ada');
  });

  testWidgets('blank full name is highlighted and does not continue',
      (tester) async {
    await _openAccount(tester);
    await tester.enterText(find.byKey(const Key('register_email')), 'ada@example.com');
    await tester.enterText(find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pump();
    expect(_error(tester, 'register_full_name'), TruberCopy.errorValidation);
    expect(find.text(TruberCopy.errorValidation), findsOneWidget);
    expect(find.byKey(const Key('register_org')), findsNothing);
  });

  testWidgets('whitespace-only full name is highlighted', (tester) async {
    await _openAccount(tester);
    await tester.enterText(find.byKey(const Key('register_full_name')), '   ');
    await tester.enterText(find.byKey(const Key('register_email')), 'ada@example.com');
    await tester.enterText(find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pump();
    expect(_error(tester, 'register_full_name'), TruberCopy.errorValidation);
    expect(find.byKey(const Key('register_org')), findsNothing);
  });

  testWidgets('empty email is highlighted', (tester) async {
    await _openAccount(tester);
    await tester.enterText(find.byKey(const Key('register_full_name')), 'Ada');
    await tester.enterText(find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pump();
    expect(_error(tester, 'register_email'), TruberCopy.errorValidation);
    expect(find.byKey(const Key('register_org')), findsNothing);
  });

  testWidgets('malformed email is highlighted', (tester) async {
    await _openAccount(tester);
    await tester.enterText(find.byKey(const Key('register_full_name')), 'Ada');
    await tester.enterText(find.byKey(const Key('register_email')), 'ada@company');
    await tester.enterText(find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pump();
    expect(_error(tester, 'register_email'), TruberCopy.errorValidation);
    expect(find.byKey(const Key('register_org')), findsNothing);
  });

  testWidgets('short password highlights the password field', (tester) async {
    await _openAccount(tester);
    await tester.enterText(find.byKey(const Key('register_full_name')), 'Ada');
    await tester.enterText(find.byKey(const Key('register_email')), 'ada@example.com');
    await tester.enterText(find.byKey(const Key('register_password')), 'short');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pump();
    expect(_error(tester, 'register_password'), TruberCopy.errorValidation);
    expect(_error(tester, 'register_full_name'), isNull);
    expect(_error(tester, 'register_email'), isNull);
    expect(find.byKey(const Key('register_org')), findsNothing);
  });
}

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/config/flags.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/screens/auth/login_screen.dart';
import 'package:truber_app/ui/screens/auth/register_screen.dart';
import 'package:truber_app/ui/screens/auth/welcome_screen.dart';
import 'package:truber_app/ui/widgets/support_mail.dart';
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

Widget _app(Widget home) => ChangeNotifierProvider(
      create: (_) => _session(),
      child: MaterialApp(theme: TruberTheme.light(), home: home),
    );

const _hidden = [
  TruberCopy.phoneCountryHelp,
  TruberCopy.sendCode,
  TruberCopy.resendCode,
  TruberCopy.otpTitle,
  TruberCopy.otpLabel,
  TruberCopy.otpCta,
  TruberCopy.otpWrong,
  TruberCopy.otpTryAgain,
  TruberCopy.verifyDemoHint,
  TruberCopy.driverSignin,
  TruberCopy.driverSigninHelp,
  TruberCopy.driverLoginHint,
];

void _expectHidden() {
  for (final text in _hidden) {
    expect(find.text(text), findsNothing, reason: text);
    expect(find.textContaining(text), findsNothing, reason: text);
  }
}

void main() {
  test('launch-visible catalog has no pre-launch words', () {
    final src = File('lib/copy/strings.dart').readAsStringSync();
    final literals = RegExp(r"'((?:\\'|[^'])*)'")
        .allMatches(src)
        .map((m) => m.group(1)!.replaceAll(r"\'", "'"))
        .where((s) => s != TruberCopy.verifyDemoHint)
        .toList();
    final banned = RegExp(
      r'\b(preview|demo|test|beta|sandbox)\b|coming soon|\bTBC\b',
      caseSensitive: false,
    );
    final hits = literals.where(banned.hasMatch).toList();
    expect(hits, isEmpty);
  });

  test('support mailto encodes the subject and hides an empty inbox', () {
    expect(supportMailto(email: '', company: 'Acme'), isNull);
    expect(supportMailto(email: '   ', company: 'Acme'), isNull);
    final uri = supportMailto(email: 'help@example.com', company: 'Acme & Co');
    expect(uri, isNotNull);
    expect(uri!.scheme, 'mailto');
    expect(uri.path, 'help@example.com');
    expect(
      uri.query,
      'subject=${Uri.encodeComponent('Truber support: Acme & Co')}',
    );
    expect(kSupportEmail, isEmpty);
    expect(kAppDomain, isEmpty);
    expect(kPhoneOtp, isFalse);
  });

  testWidgets('registration has no phone or OTP step and shows terms once',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(const RegisterScreen()));
    await tester.pumpAndSettle();
    _expectHidden();
    expect(find.byType(Checkbox), findsNothing);
    await tester.tap(find.byKey(const Key('register_role_shipper')));
    await tester.pumpAndSettle();
    _expectHidden();
    expect(find.byKey(const Key('register_phone')), findsNothing);
    expect(find.byKey(const Key('register_email')), findsOneWidget);
    expect(find.text(TruberCopy.termsNotice), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);
    expect(
      tester.widget<Text>(find.text(TruberCopy.termsNotice)).data,
      TruberCopy.termsNotice,
    );
    await tester.enterText(find.byKey(const Key('register_full_name')), 'Ada');
    await tester.enterText(
        find.byKey(const Key('register_email')), 'ada@example.com');
    await tester.enterText(
        find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('register_org')), findsOneWidget);
    _expectHidden();
    expect(find.text(TruberCopy.verifyDemoHint), findsNothing);
    await tester.enterText(find.byKey(const Key('register_org')), 'Ada Haulage');
    await tester.tap(find.byKey(const Key('register_org_save')));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.verifyTitle), findsOneWidget);
    expect(find.byKey(const Key('verify_link_id')), findsOneWidget);
    _expectHidden();
    expect(find.textContaining('OTP'), findsNothing);
    expect(find.textContaining('one-time'), findsNothing);
  });

  testWidgets('login uses email and hides driver and OTP copy', (tester) async {
    await tester.pumpWidget(_app(const LoginScreen()));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login_email')), findsOneWidget);
    expect(find.text(TruberCopy.email), findsOneWidget);
    expect(find.text(TruberCopy.loginHelp), findsOneWidget);
    expect(find.byKey(const Key('login_password')), findsOneWidget);
    _expectHidden();
    final email = tester.widget<TextField>(find.byKey(const Key('login_email')));
    expect(email.keyboardType, TextInputType.emailAddress);
  });

  testWidgets('welcome hides driver sign-in', (tester) async {
    await tester.pumpWidget(_app(const WelcomeScreen()));
    await tester.pumpAndSettle();
    _expectHidden();
  });
}

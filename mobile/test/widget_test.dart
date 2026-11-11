import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truber_app/app.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/state/session.dart';

SessionController _session() {
  MockStores.instance.quotations.clear();
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
  );
}

Future<void> _login(WidgetTester tester, String email) async {
  await tester.tap(find.text(TruberCopy.loginCta));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('login_email')), email);
  await tester.enterText(find.byKey(const Key('login_password')), 'demopass');
  await tester.tap(find.byKey(const Key('login_submit')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('welcome shows login and register CTAs', (tester) async {
    await tester.pumpWidget(TruberApp(session: _session()));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.tagline), findsOneWidget);
    expect(find.text(TruberCopy.loginCta), findsOneWidget);
    expect(find.text(TruberCopy.getStarted), findsOneWidget);
  });

  testWidgets('login as shipper shows shipper bottom nav', (tester) async {
    await tester.pumpWidget(TruberApp(session: _session()));
    await tester.pumpAndSettle();
    await _login(tester, 'shipper@truber.zw');
    expect(find.byKey(const Key('nav_shipper_home')), findsOneWidget);
    expect(find.byKey(const Key('nav_shipper_loads')), findsOneWidget);
    expect(find.byKey(const Key('nav_shipper_post')), findsOneWidget);
    expect(find.text('Harare → Bulawayo'), findsWidgets);
  });

  testWidgets('login as transporter shows transporter nav', (tester) async {
    await tester.pumpWidget(TruberApp(session: _session()));
    await tester.pumpAndSettle();
    await _login(tester, 'transporter@truber.zw');
    expect(find.byKey(const Key('nav_transporter_home')), findsOneWidget);
    expect(find.byKey(const Key('nav_transporter_search')), findsOneWidget);
  });

  testWidgets('login as admin shows admin placeholder shell', (tester) async {
    await tester.pumpWidget(TruberApp(session: _session()));
    await tester.pumpAndSettle();
    await _login(tester, 'admin@truber.zw');
    expect(find.byKey(const Key('nav_admin_home')), findsOneWidget);
    expect(find.text(TruberCopy.adminPlaceholder), findsOneWidget);
  });
}

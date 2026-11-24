import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truber_app/auth/document_link.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
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

void main() {
  test('document links need https and a dotted host', () {
    for (final bad in [
      'https://',
      'https:// ',
      'http://x.com',
      'https://x',
    ]) {
      expect(isHttpsDocumentLink(bad), isFalse, reason: bad);
    }
    expect(
      isHttpsDocumentLink('https://drive.google.com/abc'),
      isTrue,
    );
  });

  test('session rejects a bare https link and keeps a real one', () async {
    final s = _session();
    expect(
      await s.submitVerificationLinks(
          [(type: 'national_id', uri: 'https://')]),
      isFalse,
    );
    expect(s.error, TruberCopy.docLinkError);
    expect(s.submittedDocuments, isEmpty);

    expect(
      await s.submitVerificationLinks([
        (type: 'national_id', uri: 'https://drive.google.com/abc'),
      ]),
      isTrue,
    );
    expect(s.submittedDocuments.single.uri, 'https://drive.google.com/abc');
  });

  testWidgets('bare https:// shows verify.doc_link_error', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final session = _session();
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: session,
      child: ChangeNotifierProvider(
        create: (_) => ThemeController(),
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const RegisterScreen(),
        ),
      ),
    ));
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('register_role_shipper')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('register_full_name')), 'Ada');
    await tester.enterText(
        find.byKey(const Key('register_email')), 'ada@example.com');
    await tester.enterText(
        find.byKey(const Key('register_password')), 'demopass1');
    await tester.tap(find.byKey(const Key('register_submit')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('register_org')), 'Ada Co');
    await tester.tap(find.byKey(const Key('register_org_save')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('verify_link_id')), 'https://');
    await tester.tap(find.byKey(const Key('verify_submit')));
    await tester.pump();
    expect(find.text(TruberCopy.docLinkError), findsOneWidget);
    expect(session.submittedDocuments, isEmpty);
  });
}

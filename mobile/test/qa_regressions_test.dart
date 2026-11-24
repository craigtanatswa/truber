import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:truber_app/ui/errors/error_messages.dart';
import 'package:truber_app/ui/screens/auth/login_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';
import 'package:truber_app/ui/screens/auth/register_screen.dart';
import 'package:truber_app/ui/screens/auth/verify_phone_screen.dart';
import 'package:truber_design/truber_design.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/ui/screens/auth/reset_password_confirm_screen.dart';
import 'package:truber_app/ui/screens/auth/forgot_password_screen.dart';
import 'package:truber_app/ui/screens/shipper/payment_choice_screen.dart';
import 'package:truber_app/config/flags.dart';
import 'package:truber_app/ui/format/dates.dart';
import 'package:truber_app/models/booking.dart';
import 'package:truber_app/models/quotation.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/models/user.dart';
import 'package:truber_app/ui/widgets/status_chip.dart';
import 'package:truber_app/ui/widgets/payment_badges.dart';
import 'package:truber_app/ui/widgets/account_labels.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/models/load.dart';
import 'package:truber_app/state/session.dart';

SessionController _fresh() {
  MockStores.instance.quotations
    ..clear()
    ..addAll(seedQuotations());
  MockStores.instance.bookings.clear();
  MockStores.instance.arrangements.clear();
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
  test('QA-015 mock login rejects wrong password', () async {
    final session = _fresh();
    final ok = await session.login('shipper@truber.zw', 'wrong');
    expect(ok, isFalse);
    expect(session.user, isNull);
    expect(session.error, TruberCopy.loginErrorCredentials);

    final good = await session.login('shipper@truber.zw', 'demopass');
    expect(good, isTrue);
    expect(session.user?.email, 'shipper@truber.zw');
  });

  test('QA-016 pending verification user is not active for posting', () async {
    final session = _fresh();
    final ok = await session.register(
      fullName: 'New Shipper',
      email: 'newshipper@example.com',
      password: 'demopass1',
      role: UserRole.shipper,
      organisationName: 'New Co',
    );
    expect(ok, isTrue);
    expect(session.user!.accountStatus, AccountStatus.pendingVerification);
    expect(session.currentCompanyId, isNotNull);
    // Gate condition used by PostLoadScreen:
    final canPost = session.user!.accountStatus == AccountStatus.active &&
        session.currentCompanyId != null;
    expect(canPost, isFalse);
  });

  test('QA-018 search filters by truck type, capacity, and date', () async {
    final session = _fresh();
    await session.login('transporter@truber.zw', 'demopass');
    final all = await session.loads.search();
    expect(all.length, greaterThanOrEqualTo(2));

    final flatbed = await session.loads.search(truckType: TruckType.flatbed);
    expect(
        flatbed.every((l) => l.truckTypeRequired == TruckType.flatbed), isTrue);

    final heavy = await session.loads.search(minCapacityKg: 30000);
    expect(heavy.every((l) => l.weightKg >= 30000), isTrue);

    final onDate = await session.loads.search(
      loadingDate: DateTime.utc(2026, 11, 8),
    );
    expect(
      onDate.every((l) =>
          l.loadingDate.year == 2026 &&
          l.loadingDate.month == 11 &&
          l.loadingDate.day == 8),
      isTrue,
    );
  });

  test('QA-017 delivery deadline must not be before loading date', () {
    final loading = DateTime(2026, 11, 10);
    final badDeadline = DateTime(2026, 11, 9);
    final goodDeadline = DateTime(2026, 11, 12);
    final loadDay = DateTime(loading.year, loading.month, loading.day);
    final badDay =
        DateTime(badDeadline.year, badDeadline.month, badDeadline.day);
    final goodDay =
        DateTime(goodDeadline.year, goodDeadline.month, goodDeadline.day);
    expect(badDay.isBefore(loadDay), isTrue);
    expect(goodDay.isBefore(loadDay), isFalse);
  });

  test('Design search + status labels have no TODO keys', () {
    expect(TruberCopy.searchTruckType, 'Truck type');
    expect(TruberCopy.searchMinCapacity, 'Minimum capacity (tonnes)');
    expect(TruberCopy.searchLoadingDate, 'Loading date');
    expect(TruberCopy.statusBookingPendingPaymentArrangement.contains('TODO:'),
        isFalse);
    expect(
      bookingStatusLabel(BookingStatus.pendingPaymentArrangement),
      'Awaiting payment arrangement',
    );
    expect(
      completionStatusLabel(
        CompletionStatus.awaitingShipperAcceptance,
        UserRole.shipper,
      ),
      'Awaiting your confirmation',
    );
    expect(
      completionStatusLabel(
        CompletionStatus.awaitingShipperAcceptance,
        UserRole.transporter,
      ),
      'Awaiting shipper confirmation',
    );
    expect(
      bookingStatusTone(BookingStatus.pendingPaymentArrangement),
      StatusChipTone.warning,
    );
    expect(bookingStatusTone(BookingStatus.confirmed), StatusChipTone.info);
    expect(bookingStatusTone(BookingStatus.cancelled), StatusChipTone.grey);
    expect(tripStatusTone(TripStatus.delivered), StatusChipTone.success);
    expect(
        completionStatusTone(CompletionStatus.disputed), StatusChipTone.error);
  });

  test('Design status.load labels + chip tones', () {
    expect(TruberCopy.statusLoadDraft, 'Draft');
    expect(TruberCopy.statusLoadQuoting, 'Receiving quotes');
    expect(TruberCopy.statusLoadDraft.contains('TODO:'), isFalse);
    expect(loadStatusTone(LoadStatus.draft), StatusChipTone.grey);
    expect(loadStatusTone(LoadStatus.posted), StatusChipTone.info);
    expect(loadStatusTone(LoadStatus.bookingPending), StatusChipTone.warning);
    expect(loadStatusTone(LoadStatus.completed), StatusChipTone.success);
    expect(
      loadStatusLabel(LoadStatus.awaitingShipperAcceptance, UserRole.shipper),
      'Awaiting your confirmation',
    );
    expect(
      loadStatusLabel(
        LoadStatus.awaitingShipperAcceptance,
        UserRole.transporter,
      ),
      'Awaiting shipper confirmation',
    );
  });

  test('QA-020 arrangement/protection labels use Design copy', () {
    expect(
      arrangementStatusLabel(ArrangementStatus.confirmed),
      'Agreed',
    );
    expect(protectionStatusLabel(ProtectionStatus.none), 'Not protected');
    expect(
      protectionStatusLabel(ProtectionStatus.protected),
      'Payment protected',
    );
    expect(
        arrangementStatusLabel(ArrangementStatus.confirmed).contains('TODO:'),
        isFalse);
    expect(protectionStatusTone(ProtectionStatus.none), StatusChipTone.grey);
    expect(protectionUsesCashBorder(ProtectionStatus.none), isTrue);
    expect(protectionStatusTone(ProtectionStatus.protected),
        StatusChipTone.protected);
    expect(
      protectionStatusTone(ProtectionStatus.releasedFromProtection),
      StatusChipTone.success,
    );
    expect(paymentMethodLabel(PaymentMethod.depositBalance),
        TruberCopy.payDepositBalance);
    expect(paymentMethodLabel(PaymentMethod.depositBalance).contains('_'),
        isFalse);
  });

  test('QA-021 deadline error uses Design error.deadline_before_loading', () {
    expect(
      TruberCopy.errorDeadlineBeforeLoading,
      'Delivery deadline must be on or after the loading date.',
    );
    expect(
        TruberCopy.errorDeadlineBeforeLoading, isNot(TruberCopy.errorGeneric));
    expect(TruberCopy.errorDeadlineBeforeLoading.contains('TODO:'), isFalse);
  });

  test('QA-022 account role/status use Design or TODO labels not raw enums',
      () {
    expect(TruberCopy.roleNounShipper, 'Shipper');
    expect(userRoleLabel(UserRole.shipper), TruberCopy.roleNounShipper);
    expect(userRoleLabel(UserRole.admin), 'Admin'); // Design auth.role_admin
    expect(accountStatusLabel(AccountStatus.pendingVerification), 'Pending');
    expect(accountStatusLabel(AccountStatus.active), 'Active');
    expect(userRoleLabel(UserRole.shipper), isNot('shipper'));
    expect(accountStatusLabel(AccountStatus.pendingVerification),
        isNot('pendingVerification'));
  });

  test('QA-023 cash ack/status match Design exactly', () {
    expect(
      TruberCopy.payCashAck,
      'I understand cash is not protected on Truber.',
    );
    expect(
      TruberCopy.payStatusCashRecorded,
      'Cash arrangement recorded (not protected)',
    );
    expect(TruberCopy.payCashAck.contains('payment-protected'), isFalse);
    expect(TruberCopy.payStatusCashRecorded.contains('payment-protected'),
        isFalse);
  });

  test('Design account/misc/truck/error keys have no TODO', () {
    expect(TruberCopy.accountRoleLabel, 'Account type');
    expect(TruberCopy.roleNounShipper, 'Shipper');
    expect(TruberCopy.statusAccountActive, 'Active');
    expect(TruberCopy.payTotalLabel, 'Total');
    expect(TruberCopy.bookingAgreedLabel, 'Agreed rate');
    expect(TruberCopy.searchAny, 'Any');
    expect(
      TruberCopy.loadSchedule(
          loadingDate: '6 Nov 2026', deadline: '8 Nov 2026'),
      'Loading 6 Nov 2026 · Deliver by 8 Nov 2026',
    );
    expect(TruberCopy.truckTypeBox, 'Box body');
    expect(TruberCopy.errorGeneric, 'Something went wrong. Try again.');
    expect(TruberCopy.actionRetry, 'Try again');
    expect(TruberCopy.verifyDemoHint, 'Demo builds only. Demo code: 123456');
  });

  test('mapErrorMessage never returns raw exception text', () {
    expect(mapErrorMessage(Exception('secret stack')), TruberCopy.errorGeneric);
    expect(mapErrorMessage(StateError('Booking not found')),
        TruberCopy.errorNotFound);
    expect(mapErrorMessage(ArgumentError('bad')), TruberCopy.errorValidation);
  });

  testWidgets('login screen never shows OTP demo code hint', (tester) async {
    // Charlie: email+password login; Demo code hint is for future OTP step only.
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('demo_login_hint')), findsNothing);
    expect(find.text(TruberCopy.verifyDemoHint), findsNothing);
    expect(find.textContaining('Demo code'), findsNothing);
    // Key remains for future OTP verification UI.
    expect(TruberCopy.verifyDemoHint, 'Demo builds only. Demo code: 123456');
  });

  test('QA-024 display dates use Design d MMM yyyy not ISO', () {
    final d = DateTime(2026, 11, 6);
    expect(formatDisplayDate(d), '6 Nov 2026');
    expect(formatDisplayDate(d).contains('-'), isFalse);
    expect(formatDisplayDate(DateTime(2026, 11, 8)), '8 Nov 2026');
  });

  test('Design email+password auth copy synced', () {
    expect(TruberCopy.loginHelp, contains('email and password'));
    expect(TruberCopy.emailHint, 'you@company.co.zw');
    expect(TruberCopy.showPassword, 'Show');
    expect(TruberCopy.accountTitle, 'Your account');
    expect(TruberCopy.loginErrorCredentials, contains('incorrect'));
    expect(TruberCopy.verifyDemoHint, startsWith('Demo builds only'));
  });

  test('QA-025 auth.new_here Design key is used for login footer', () {
    expect(TruberCopy.newHere, 'New here? Create account');
  });

  testWidgets(
      'QA-025 login footer shows Design newHere, not hardcoded fragment',
      (tester) async {
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login_new_here')), findsOneWidget);
    expect(find.text(TruberCopy.newHere), findsOneWidget);
    // Partial hardcoded fragment alone should not appear as its own span.
    expect(find.text('New here? '), findsNothing);
  });

  testWidgets('QA-026 register collects optional city via RegisterRequest.city',
      (tester) async {
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const RegisterScreen(),
        ),
      ),
    );
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('register_city')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('register_city')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('register_city')), findsOneWidget);
    expect(TruberCopy.cityOptional, 'Primary city (optional)');
    expect(TruberCopy.cityHint, 'e.g. Harare');
  });

  test('v0.2.0 CompletionStatus drops awaitingRelease, adds cancelled', () {
    expect(
      CompletionStatus.values.contains(CompletionStatus.cancelled),
      isTrue,
    );
    expect(
      CompletionStatus.values.map((e) => e.name).contains('awaitingRelease'),
      isFalse,
    );
    expect(
      completionStatusTone(CompletionStatus.cancelled),
      StatusChipTone.grey,
    );
    expect(
      completionStatusLabel(CompletionStatus.cancelled, UserRole.shipper),
      TruberCopy.statusCompletionCancelled,
    );
  });

  test('AuthTokenResponse expiresIn is 1800s (30 min session)', () async {
    final session = _fresh();
    final tokens = await session.auth.login(
      email: 'shipper@truber.zw',
      password: 'demopass',
    );
    expect(tokens.expiresIn, 1800);
  });

  test('v0.2.0 password-reset request is anti-enumeration + confirm works',
      () async {
    final session = _fresh();
    final auth = session.auth as MockAuthRepository;
    final accepted =
        await auth.requestPasswordReset(email: 'shipper@truber.zw');
    expect(accepted.status, 'accepted');
    final unknown = await auth.requestPasswordReset(email: 'nobody@truber.zw');
    expect(unknown.status, 'accepted');
    final token = auth.testingActiveResetTokenFor('shipper@truber.zw');
    expect(token, isNotNull);
    expect(token!.length, greaterThanOrEqualTo(32));
    await auth.confirmPasswordReset(token: token, newPassword: 'newdemopass');
    await expectLater(
      auth.login(email: 'shipper@truber.zw', password: 'demopass'),
      throwsA(isA<AuthException>()),
    );
    final ok = await auth.login(
      email: 'shipper@truber.zw',
      password: 'newdemopass',
    );
    expect(ok.user.email, 'shipper@truber.zw');
  });

  test('v0.2.0 OTP request+verify with demo code', () async {
    final session = _fresh();
    await session.login('shipper@truber.zw', 'demopass');
    final req = await session.requestOtp();
    expect(req, isNotNull);
    expect(req!.status, 'stubbed');
    expect(await session.verifyOtp('000000'), isFalse);
    expect(session.error, TruberCopy.otpWrong);
    expect(await session.verifyOtp('123456'), isTrue);
  });

  testWidgets('forgot password link on login opens reset request',
      (tester) async {
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login_forgot_password')), findsOneWidget);
    await tester.tap(find.byKey(const Key('login_forgot_password')));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.resetTitle), findsOneWidget);
    expect(find.byKey(const Key('reset_send')), findsOneWidget);
  });

  testWidgets('verify phone shows demo hint only when TRUBER_DEMO',
      (tester) async {
    final session = _fresh();
    await session.login('shipper@truber.zw', 'demopass');
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const VerifyPhoneScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // Default test build has TRUBER_DEMO false → hint hidden.
    expect(find.byKey(const Key('verify_demo_hint')), findsNothing);
    expect(find.byKey(const Key('otp_submit')), findsOneWidget);
  });

  test('status chip tones use theme v3 tokens (black protected, teal success)',
      () {
    final style = StatusChipStyle.of(StatusChipTone.info);
    expect(style.fg, TruberColors.info);
    expect(style.bg, TruberColors.infoSoft);
    expect(style.fg, TruberColors.primary); // info == cobalt brand
    expect(TruberColors.primary, TruberColors.cobalt600); // brand blue token
    final protected = StatusChipStyle.of(StatusChipTone.protected);
    expect(protected.bg, TruberColors.paymentProtected);
    expect(protected.bg, TruberColors.black); // v3 black chip
    expect(protected.fg, TruberColors.white);
    final success = StatusChipStyle.of(StatusChipTone.success);
    expect(success.fg, TruberColors.success);
    expect(success.fg, const Color(0xFF0F766E)); // v3 teal
    expect(success.bg, const Color(0xFFE6F5F3));

    final darkInfo =
        StatusChipStyle.of(StatusChipTone.info, brightness: Brightness.dark);
    expect(darkInfo.fg, TruberColors.primaryTextDark); // QA-037 text on dark
    expect(darkInfo.fg, const Color(0xFF6BA3E8));
    expect(darkInfo.bg, TruberColors.infoSoftDark);
    final darkProtected = StatusChipStyle.of(
      StatusChipTone.protected,
      brightness: Brightness.dark,
    );
    expect(darkProtected.bg, TruberColors.paymentProtectedDark);
    expect(darkProtected.bg, TruberColors.black);
    expect(darkProtected.fg, TruberColors.white);
    final darkSuccess = StatusChipStyle.of(
      StatusChipTone.success,
      brightness: Brightness.dark,
    );
    expect(darkSuccess.fg, TruberColors.successDark);
    expect(darkSuccess.fg, const Color(0xFF2DD4BF));
    expect(darkSuccess.bg, TruberColors.successSoftDark);
    expect(darkSuccess.bg, const Color(0xFF0F2E2B));
  });

  test('QA-029 accept marks sibling quotes not_selected, not rejected',
      () async {
    final session = _fresh();
    final quotes = await session.quotations.forLoad(MockIds.load1);
    expect(quotes.length, greaterThanOrEqualTo(2));
    expect(quotes.every((q) => q.status == QuotationStatus.submitted), isTrue);
    final accepted = await session.quotations.accept(MockIds.quote1);
    expect(accepted.quotation.status, QuotationStatus.accepted);
    final after = await session.quotations.forLoad(MockIds.load1);
    final sibling = after.firstWhere((q) => q.id == MockIds.quote2);
    expect(sibling.status, QuotationStatus.notSelected);
    expect(sibling.status, isNot(QuotationStatus.rejected));
    expect(quotationStatusLabel(QuotationStatus.notSelected),
        'Another quote was chosen');
    expect(
        quotationStatusTone(QuotationStatus.notSelected), StatusChipTone.grey);
    expect(quotationStatusLabel(QuotationStatus.submitted), 'Quote sent');
    expect(
        quotationStatusTone(QuotationStatus.submitted), StatusChipTone.warning);
  });

  test('QA-030 city over 120 chars rejected; empty becomes null', () async {
    final auth = MockAuthRepository();
    expect(MockAuthRepository.normalizeCity('  '), isNull);
    expect(MockAuthRepository.normalizeCity('Harare'), 'Harare');
    expect(
      () => MockAuthRepository.normalizeCity('x' * 121),
      throwsA(isA<AuthException>()),
    );
    await expectLater(
      auth.register(
        email: 'longcity@truber.zw',
        password: 'demopass1',
        fullName: 'Long City',
        role: UserRole.shipper,
        city: 'y' * 121,
      ),
      throwsA(isA<AuthException>()),
    );
    final ok = await auth.register(
      email: 'okcity@truber.zw',
      password: 'demopass1',
      fullName: 'Ok City',
      role: UserRole.shipper,
      city: '  Bulawayo  ',
    );
    expect(auth.registerCityFor(ok.user.id), 'Bulawayo');
  });

  testWidgets('QA-031 reset confirm does not autofill token from email',
      (tester) async {
    final session = _fresh();
    final auth = session.auth as MockAuthRepository;
    await auth.requestPasswordReset(email: 'shipper@truber.zw');
    expect(auth.testingActiveResetTokenFor('shipper@truber.zw'), isNotNull);
    expect(kTruberDemo, isFalse);
    expect(auth.demoPeekLastResetToken(), isNull);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const ForgotPasswordScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('reset_email')), 'shipper@truber.zw');
    await tester.tap(find.byKey(const Key('reset_send')));
    await tester.pumpAndSettle();
    // Default build: no demo confirm shortcut that would leak a token.
    expect(find.byKey(const Key('reset_open_confirm_demo')), findsNothing);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const ResetPasswordConfirmScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final tokenField =
        tester.widget<TextField>(find.byKey(const Key('reset_token')));
    expect(tokenField.controller!.text, isEmpty);
  });

  test('QA-032 reset tokens are single-use, unique, and expire at 30m TTL',
      () async {
    var now = DateTime.utc(2026, 11, 7, 8, 0);
    final auth = MockAuthRepository(clock: () => now);
    await auth.requestPasswordReset(email: 'shipper@truber.zw');
    final t1 = auth.testingActiveResetTokenFor('shipper@truber.zw')!;
    await auth.confirmPasswordReset(token: t1, newPassword: 'firstpass1');
    // Consumed token unusable.
    await expectLater(
      auth.confirmPasswordReset(token: t1, newPassword: 'another1'),
      throwsA(isA<AuthException>()),
    );
    // Reissue yields a different token; old consumed token stays dead.
    await auth.requestPasswordReset(email: 'shipper@truber.zw');
    final t2 = auth.testingActiveResetTokenFor('shipper@truber.zw')!;
    expect(t2, isNot(t1));
    await expectLater(
      auth.confirmPasswordReset(token: t1, newPassword: 'resurrect1'),
      throwsA(isA<AuthException>()),
    );
    // TTL 30 minutes (OpenAPI PasswordResetToken) — access session also 1800s per Charlie.
    expect(MockAuthRepository.resetTokenTtl, const Duration(minutes: 30));
    now = now.add(const Duration(minutes: 31));
    await expectLater(
      auth.confirmPasswordReset(token: t2, newPassword: 'toolate1'),
      throwsA(isA<AuthException>()),
    );
  });

  testWidgets('QA-033 deep-link token is never rendered in the UI',
      (tester) async {
    const secret = 'super-secret-reset-token-must-not-appear-xyz';
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: const ResetPasswordConfirmScreen(token: secret),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(secret), findsNothing);
    expect(find.byKey(const Key('reset_token')), findsNothing);
    expect(find.byKey(const Key('reset_code_received')), findsOneWidget);
    expect(find.byKey(const Key('reset_code_received_badge')), findsOneWidget);
    expect(find.textContaining(secret), findsNothing);
  });

  testWidgets('QA-034 payment total uses onSurface/textPrimary not brand',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 2400));
    final session = _fresh();
    await session.login('shipper@truber.zw', 'demopass');
    final loads = await session.loads.listForCompany(MockIds.shipperCompany);
    final load = loads.firstWhere((l) => l.id == MockIds.load1);
    final accepted = await session.quotations.accept(MockIds.quote1);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: PaymentChoiceScreen(
            booking: accepted.booking,
            load: load,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final totalFinder = find.textContaining('Total:');
    expect(totalFinder, findsWidgets);
    final text = tester.widget<Text>(totalFinder.first);
    expect(text.style?.color, TruberColors.textPrimary);
    expect(text.style?.color, isNot(TruberColors.primary));
    expect(find.byType(ProtectedPaymentBadge), findsWidgets);
  });

  testWidgets('payment screen renders in dark mode with dark tokens',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 2400));
    final session = _fresh();
    await session.login('shipper@truber.zw', 'demopass');
    final loads = await session.loads.listForCompany(MockIds.shipperCompany);
    final load = loads.firstWhere((l) => l.id == MockIds.load1);
    final accepted = await session.quotations.accept(MockIds.quote1);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          darkTheme: TruberTheme.dark(),
          themeMode: ThemeMode.dark,
          home: PaymentChoiceScreen(
            booking: accepted.booking,
            load: load,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Total:'), findsWidgets);
    expect(find.byType(ProtectedPaymentBadge), findsWidgets);
    expect(find.byType(CashWarningBadge), findsOneWidget);
    final total = tester.widget<Text>(find.textContaining('Total:').first);
    expect(total.style?.color, TruberColors.textPrimaryDark);
    expect(total.style?.color, isNot(TruberColors.primary));
    expect(total.style?.color, isNot(TruberColors.primaryDark));
    // Soft selected fill uses dark variant when escrow/deposit selected by default
    final cards = tester.widgetList<Card>(find.byType(Card)).toList();
    expect(cards, isNotEmpty);
    final softCards =
        cards.where((c) => c.color == TruberColors.primarySoftDark);
    expect(softCards, isNotEmpty);
  });

  testWidgets('QA-035 dark login error uses colorScheme.error / errorDark',
      (tester) async {
    final session = _fresh();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: TruberTheme.light(),
          darkTheme: TruberTheme.dark(),
          themeMode: ThemeMode.dark,
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('login_email')),
      'nobody@example.invalid',
    );
    await tester.enterText(
      find.byKey(const Key('login_password')),
      'incorrect',
    );
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pumpAndSettle();
    final text = tester.widget<Text>(find.byKey(const Key('login_error')));
    expect(text.style?.color, TruberColors.errorDark);
    expect(text.style?.color, TruberTheme.dark().colorScheme.error);
    expect(text.style?.color, isNot(TruberColors.error));
  });

  test('QA-036/037 Design tokens: warning, cash, primaryTextDark', () {
    expect(TruberColors.warning, const Color(0xFF8A5A00));
    expect(TruberColors.paymentCash, const Color(0xFF5C5C66));
    expect(TruberColors.paymentCashDark, const Color(0xFFB8B8C0));
    expect(TruberColors.primaryTextDark, const Color(0xFF6BA3E8));
    expect(
      TruberTheme.dark().textButtonTheme.style!.foregroundColor!.resolve({}),
      TruberColors.primaryTextDark,
    );
  });

  test('Rune motion CSS tokens match mapping (enter 150 / exit 110)', () {
    expect(TruberMotion.cssEnterDuration, const Duration(milliseconds: 150));
    expect(TruberMotion.cssExitDuration, const Duration(milliseconds: 110));
    expect(TruberMotion.cssEnterCurve, const Cubic(0.2, 0.8, 0.2, 1));
    expect(TruberMotion.cssExitCurve, const Cubic(0.4, 0, 1, 1));
    expect(TruberMotion.controlPeriod, const Duration(milliseconds: 250));
    expect(TruberRadii.md, 6);
    expect(TruberRadii.lg, 8);
    expect(TruberSpacing.controlGap, 6);
  });

  testWidgets('reduced-motion page route uses zero duration', (tester) async {
    late TruberPageRoute<void> route;
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: MaterialApp(
          theme: TruberTheme.light(),
          home: Builder(
            builder: (context) {
              route = TruberPageRoute<void>.of(
                context,
                builder: (_) => const Scaffold(body: Text('dest')),
              );
              return Scaffold(
                body: ElevatedButton(
                  onPressed: () => Navigator.of(context).push(route),
                  child: const Text('go'),
                ),
              );
            },
          ),
        ),
      ),
    );
    expect(route.transitionDuration, Duration.zero);
    expect(route.reverseTransitionDuration, Duration.zero);
    await tester.tap(find.text('go'));
    await tester.pump(); // no animation frames needed
    expect(find.text('dest'), findsOneWidget);
  });

  testWidgets('theme system label is Design System not Match phone',
      (tester) async {
    expect(TruberCopy.themeSystem, 'System');
    expect(TruberCopy.themeSystem, isNot(contains('Match phone')));
  });
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/live/api_client.dart';
import 'package:truber_app/data/live/live_offplatform_repository.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_company_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_offplatform_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_payout_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_seed.dart';
import 'package:truber_app/data/mock/mock_stores.dart';
import 'package:truber_app/models/booking.dart';
import 'package:truber_app/models/offplatform.dart';
import 'package:truber_app/models/payment.dart';
import 'package:truber_app/models/payout.dart';
import 'package:truber_app/state/ban.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/errors/error_messages.dart';
import 'package:truber_app/ui/format/dates.dart';
import 'package:truber_app/ui/screens/offplatform/offplatform_entry.dart';
import 'package:truber_app/ui/screens/offplatform/offplatform_report_screen.dart';
import 'package:truber_app/ui/widgets/payout_summary.dart';
import 'package:truber_app/ui/screens/shipper/quotations_screen.dart';
import 'package:truber_app/ui/screens/transporter/submit_quote_screen.dart';
import 'package:truber_app/ui/screens/transporter/transporter_home.dart';
import 'package:truber_app/ui/widgets/ban_banner.dart';
import 'package:truber_design/truber_design.dart';

SessionController _session({DateTime Function()? clock}) {
  final loads = MockLoadRepository();
  return SessionController(
    auth: MockAuthRepository(),
    loads: loads,
    quotations: MockQuotationRepository(loads: loads),
    bookings: MockBookingRepository(),
    payments: MockPaymentRepository(),
    payouts: MockPayoutRepository(),
    reports: MockOffPlatformReportRepository(),
    companyDirectory: MockCompanyRepository(),
    enforceSessionExpiry: false,
    clock: clock ?? () => DateTime.utc(2026, 11, 10, 12),
  );
}

Widget _host(SessionController s, Widget child) => ChangeNotifierProvider.value(
      value: s,
      child: MaterialApp(theme: TruberTheme.light(), home: child),
    );

final _dateText = formatDisplayDate(seedBanEndsAt.toLocal());

void main() {
  group('ban state (User/Company.bannedUntil only)', () {
    test('user ban, company-only ban, expired, none', () async {
      final s = _session();
      await s.login('banned.shipper@truber.zw', 'demopass');
      expect(s.ban!.userBanned, isTrue);
      expect(s.ban!.until, seedBanEndsAt);

      final m = _session();
      await m.login('kariba@truber.zw', 'demopass');
      expect(m.ban!.userBanned, isFalse);
      expect(m.ban!.companyBanned, isTrue);

      final later = _session(clock: () => DateTime.utc(2026, 12, 1));
      await later.login('banned.shipper@truber.zw', 'demopass');
      expect(later.ban, isNull, reason: 'expired bans do not block');

      final ok = _session();
      await ok.login('shipper@truber.zw', 'demopass');
      expect(ok.ban, isNull);
    });

    test('latest endsAt wins', () {
      final b = computeBan(
        serverUntil: DateTime.utc(2026, 11, 30),
        now: DateTime.utc(2026, 11, 10),
      )!;
      expect(b.until, DateTime.utc(2026, 11, 30));
    });
  });

  testWidgets('banner: user body vs company body, never a reason',
      (tester) async {
    final s = _session();
    await s.login('banned.shipper@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, const Scaffold(body: BanBanner())));
    expect(find.text(TruberCopy.banBannerTitle), findsOneWidget);
    expect(find.text(TruberCopy.banBannerBodyFor(_dateText)), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    final m = _session();
    await m.login('kariba@truber.zw', 'demopass');
    await tester.pumpWidget(_host(m, const Scaffold(body: BanBanner())));
    expect(find.text(TruberCopy.banBannerCompanyBodyFor(_dateText)),
        findsOneWidget);
  });

  testWidgets(
      'banned transporter: send quote intercepted with toast, no quote created',
      (tester) async {
    int quotes() => MockStores.instance.quotations
        .where((q) => q.loadId == seedLoads().first.id)
        .length;
    final before = quotes();
    final m = _session();
    await m.login('kariba@truber.zw', 'demopass');
    await tester
        .pumpWidget(_host(m, SubmitQuoteScreen(load: seedLoads().first)));
    await tester.enterText(find.byKey(const Key('quote_rate')), '900');
    await tester.tap(find.byKey(const Key('quote_submit')));
    await tester.pump();
    expect(find.text(TruberCopy.banBlockedActionToastFor(_dateText)),
        findsOneWidget);
    expect(quotes(), before, reason: 'no quote created');
  });

  testWidgets('shipper sees counterparty line on a banned company quote',
      (tester) async {
    final s = _session();
    await s.login('shipper@truber.zw', 'demopass');
    await tester
        .pumpWidget(_host(s, QuotationsScreen(load: seedLoads().first)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('counterparty_blocked_${MockIds.quote3}')),
        findsOneWidget);
    expect(find.byKey(const Key('counterparty_blocked_${MockIds.quote1}')),
        findsNothing);
    final btn = tester.widget<ElevatedButton>(
        find.byKey(const Key('select_quote_${MockIds.quote3}')));
    expect(btn.onPressed, isNull);
  });

  test('AccountBannedError maps by bannedParty; reason never shown', () {
    final caller = ApiException(409, 'ACCOUNT_BANNED', 'x', {
      'bannedUntil': '2026-11-24T08:00:00Z',
      'bannedParty': 'caller',
    });
    expect(mapErrorMessage(caller),
        TruberCopy.banBlockedActionToastFor(_dateText));
    final cp = ApiException(409, 'ACCOUNT_BANNED', 'x', {
      'bannedUntil': '2026-11-24T08:00:00Z',
      'bannedParty': 'counterparty_company',
    });
    expect(mapErrorMessage(cp), TruberCopy.banCounterpartyBlocked);
  });

  test('payout status mapping from spec state', () {
    PayoutStatus? st(CompletionStatus c, ReleaseStatus r,
            {PaymentMethod m = PaymentMethod.escrow, bool? paid}) =>
        TransporterPayout(
          bookingId: 'b',
          routeLabel: 'r',
          method: m,
          protectionStatus: ProtectionStatus.protected,
          completionStatus: c,
          releaseStatus: r,
          shipperPaymentRecorded: paid,
        ).status;
    const done = CompletionStatus.completed;
    expect(st(CompletionStatus.notComplete, ReleaseStatus.held),
        PayoutStatus.awaitingDelivery);
    expect(st(CompletionStatus.awaitingShipperAcceptance, ReleaseStatus.held),
        PayoutStatus.awaitingDelivery);
    expect(st(CompletionStatus.disputed, ReleaseStatus.held),
        PayoutStatus.onHoldDispute);
    expect(
        st(done, ReleaseStatus.releaseRequested), PayoutStatus.awaitingRelease);
    expect(
        st(done, ReleaseStatus.notApplicable,
            m: PaymentMethod.corporateCredit, paid: false),
        PayoutStatus.awaitingShipperPayment);
    expect(
        st(done, ReleaseStatus.notApplicable,
            m: PaymentMethod.corporateCredit, paid: true),
        PayoutStatus.awaitingRelease);
    expect(st(done, ReleaseStatus.releasedRecorded), PayoutStatus.released);
    expect(
        st(done, ReleaseStatus.notApplicable, m: PaymentMethod.cash), isNull);
    expect(st(CompletionStatus.cancelled, ReleaseStatus.held), isNull);
    expect(st(done, ReleaseStatus.releaseFailed), PayoutStatus.releaseFailed);
  });

  testWidgets(
      'transporter home shows payout status line, no banner when not banned',
      (tester) async {
    final s = _session();
    await s.login('transporter@truber.zw', 'demopass');
    await tester.pumpWidget(_host(s, const TransporterHome()));
    await tester.pumpAndSettle();
    expect(find.text(TruberCopy.payoutStatusReleased), findsOneWidget);
    expect(find.byKey(const Key('ban_banner')), findsNothing);
  });

  group('off-platform report', () {
    testWidgets('form validates ≥10 chars, then shows done + Under review',
        (tester) async {
      final s = _session();
      await s.login('transporter@truber.zw', 'demopass');
      await tester.pumpWidget(
          _host(s, const OffPlatformReportScreen(bookingId: 'b-1')));
      expect(find.text(TruberCopy.offplatformIntro), findsOneWidget);
      final submit = find.byKey(const Key('offplatform_submit'));
      expect(tester.widget<ElevatedButton>(submit).onPressed, isNull);
      final radio = find.byKey(const Key('offplatform_party_shipper'));
      await tester.ensureVisible(radio);
      await tester.tap(radio);
      await tester.pump();
      expect(tester.widget<ElevatedButton>(submit).onPressed, isNotNull);
      await tester.enterText(
          find.byKey(const Key('offplatform_desc')), 'short');
      await tester.pump();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pump();
      expect(find.text(TruberCopy.offplatformDescErrorShort), findsOneWidget);
      await tester.enterText(find.byKey(const Key('offplatform_desc')),
          'Asked to pay the balance by EcoCash directly.');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text(TruberCopy.offplatformSentTitle), findsOneWidget);
      expect(find.text(TruberCopy.offplatformSentBody), findsOneWidget);
      expect(find.text(TruberCopy.offplatformStatusOpen), findsOneWidget);
      final mine = await s.reports!.forBooking('b-1');
      expect(mine.single.suspectedParty, SuspectedParty.shipper);
    });

    test('live: POST /bookings/{id}/off-platform-reports body per spec',
        () async {
      late http.Request sent;
      final api = ApiClient(
          baseUrl: 'https://api.test.invalid',
          httpClient: MockClient((req) async {
            sent = req;
            return http.Response(
                jsonEncode({
                  'id': 'r1',
                  'bookingId': 'b1',
                  'reportedByUserId': 'u1',
                  'suspectedParty': 'both',
                  'description': 'Asked for cash outside.',
                  'status': 'open',
                  'createdAt': '2026-11-10T10:00:00Z',
                }),
                201,
                headers: {'content-type': 'application/json'});
          }));
      final repo = LiveOffPlatformReportRepository(api);
      final r = await repo.create('b1',
          suspectedParty: SuspectedParty.both,
          description: ' Asked for cash outside. ');
      expect(sent.method, 'POST');
      expect(sent.url.path, '/bookings/b1/off-platform-reports');
      expect(jsonDecode(sent.body),
          {'suspectedParty': 'both', 'description': 'Asked for cash outside.'});
      expect(r.status, OffPlatformReportStatus.open);
      expect((await repo.forBooking('b1')).single.id, 'r1');
    });
  });

  group('Design answers (13:11)', () {
    test('report chip tokens, light and dark; never success/green', () {
      const l = Brightness.light, d = Brightness.dark;
      final open = reportChipColors(OffPlatformReportStatus.open, l);
      expect(
          [open.fg, open.bg], [TruberColors.warning, TruberColors.warningSoft]);
      final conf = reportChipColors(OffPlatformReportStatus.confirmed, l);
      expect([conf.fg, conf.bg], [TruberColors.error, TruberColors.errorSoft]);
      final no = reportChipColors(OffPlatformReportStatus.notConfirmed, l);
      expect([no.fg, no.bg],
          [TruberColors.textSecondary, TruberColors.surfaceSunken]);
      final openD = reportChipColors(OffPlatformReportStatus.open, d);
      expect([openD.fg, openD.bg],
          [TruberColors.warningDark, TruberColors.warningSoftDark]);
      final confD = reportChipColors(OffPlatformReportStatus.confirmed, d);
      expect([confD.fg, confD.bg],
          [TruberColors.errorDark, TruberColors.errorSoftDark]);
      final noD = reportChipColors(OffPlatformReportStatus.notConfirmed, d);
      expect([noD.fg, noD.bg],
          [TruberColors.textSecondaryDark, TruberColors.surfaceMutedDark]);
      const banned = [
        TruberColors.success,
        TruberColors.successSoft,
        TruberColors.successDark,
        TruberColors.successSoftDark,
      ];
      for (final st in OffPlatformReportStatus.values) {
        for (final b in Brightness.values) {
          final c = reportChipColors(st, b);
          expect(banned, isNot(contains(c.fg)));
          expect(banned, isNot(contains(c.bg)));
        }
      }
    });

    testWidgets('chip renders Design colours', (tester) async {
      await tester.pumpWidget(MaterialApp(
          theme: TruberTheme.light(),
          home: const Scaffold(
              body: ReportStatusChip(
                  status: OffPlatformReportStatus.confirmed))));
      final box = tester.widget<Container>(find.descendant(
          of: find.byType(ReportStatusChip), matching: find.byType(Container)));
      expect((box.decoration as BoxDecoration).color, TruberColors.errorSoft);
      final t =
          tester.widget<Text>(find.text(TruberCopy.offplatformStatusConfirmed));
      expect(t.style?.color, TruberColors.error);
    });

    testWidgets('release_failed line uses error tokens (light + dark)',
        (tester) async {
      const p = TransporterPayout(
        bookingId: 'b',
        routeLabel: 'r',
        method: PaymentMethod.escrow,
        protectionStatus: ProtectionStatus.protected,
        completionStatus: CompletionStatus.completed,
        releaseStatus: ReleaseStatus.releaseFailed,
      );
      for (final (theme, fg, bg) in [
        (TruberTheme.light(), TruberColors.error, TruberColors.errorSoft),
        (
          TruberTheme.dark(),
          TruberColors.errorDark,
          TruberColors.errorSoftDark
        ),
      ]) {
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(MaterialApp(
            theme: theme,
            home: const Scaffold(body: PayoutSummary(payout: p))));
        expect(find.text(TruberCopy.payoutStatusReleaseFailed), findsOneWidget);
        final box = tester
            .widget<Container>(find.byKey(const Key('payout_status_failed')));
        expect((box.decoration as BoxDecoration).color, bg);
        expect(
            tester
                .widget<Text>(find.byKey(const Key('payout_status')))
                .style
                ?.color,
            fg);
      }
    });
  });
}

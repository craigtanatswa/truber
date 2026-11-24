import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'ui/theme/truber_app_theme.dart';
import 'package:provider/provider.dart';

import 'config/flags.dart';
import 'data/live/api_client.dart';
import 'data/live/live_repositories.dart';
import 'data/live/unavailable_repositories.dart';
import 'data/mock/mock_auth_repository.dart';
import 'data/mock/mock_booking_repository.dart';
import 'data/mock/mock_load_repository.dart';
import 'data/mock/mock_payment_repository.dart';
import 'data/mock/mock_payout_repository.dart';
import 'data/mock/mock_company_repository.dart';
import 'data/mock/mock_offplatform_repository.dart';
import 'data/live/live_offplatform_repository.dart';
import 'data/live/live_payout_repository.dart';
import 'data/mock/mock_quotation_repository.dart';
import 'data/mock/mock_seed.dart';
import 'models/booking.dart';
import 'models/money.dart';
import 'models/payment.dart';
import 'models/quotation.dart';
import 'state/session.dart';
import 'state/theme_controller.dart';
import 'ui/screens/auth/forgot_password_screen.dart';
import 'ui/screens/auth/login_screen.dart';
import 'ui/screens/auth/register_screen.dart';
import 'ui/screens/auth/reset_password_confirm_screen.dart';
import 'ui/screens/auth/verify_phone_screen.dart';
import 'ui/screens/shell/admin_shell.dart';
import 'ui/screens/shell/role_shell.dart';
import 'ui/screens/shell/shipper_shell.dart';
import 'ui/screens/shell/transporter_shell.dart';
import 'ui/screens/shipper/booking_confirm_screen.dart';
import 'ui/screens/shipper/payment_choice_screen.dart';
import 'ui/screens/shipper/quotations_screen.dart';

class _DemoRoute {
  const _DemoRoute(this.role, {this.tab});
  final String role;
  final String? tab;
}

_DemoRoute? _parseDemo() {
  if (!kIsWeb) return null;
  final hash = Uri.base.fragment;
  final m = RegExp(
    r'demo/(login|register|reset-confirm|reset|otp|banned-shipper|banned-transporter-user|banned-transporter|shipper|transporter|admin)(?:/(post|search|quotes|payment-odd|payment|booking|booking-transfer|account))?',
  ).firstMatch(hash);
  if (m == null) return null;
  return _DemoRoute(m.group(1)!, tab: m.group(2));
}

SessionController createDefaultSession() {
  // Const so a TRUBER_DATA=live build drops the mock graph, including demopass.
  if (kIncludeMockData) return _createMockSession();
  return createLiveSession(kApiBaseUrl);
}

SessionController _createMockSession() {
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
  );
}

/// Live: auth, companies and loads over HTTP (OpenAPI v0.4.0). Quotations,
/// bookings and payment arrangements are not served by the test backend yet:
/// they fail visibly (error.server) rather than faking success on mocks.
SessionController createLiveSession(String baseUrl) {
  final api = ApiClient(baseUrl: baseUrl);
  final loads = LiveLoadRepository(api);
  final session = SessionController(
    auth: LiveAuthRepository(api),
    companies: LiveCompanyRepository(api),
    loads: loads,
    quotations: UnavailableQuotationRepository(),
    bookings: UnavailableBookingRepository(),
    payments: UnavailablePaymentRepository(),
    payouts: LivePayoutRepository(),
    verifications: LiveVerificationRepository(api),
    reports: LiveOffPlatformReportRepository(api),
    companyDirectory: LiveCompanyRepository(api),
    otpRequestsAllowed: false,
  );
  api.onSessionExpired = session.handleSessionExpired;
  return session;
}

/// Seeded demo login. Only referenced from [kDemoAids], so live builds
/// drop the password literal.
void _signInDemo(SessionController s, _DemoRoute? demo) {
  if (demo == null || kDataMode != DataMode.mock) return;
  if (!kPhoneOtp && demo.role == 'otp') return;
  if (demo.role == 'login' ||
      demo.role == 'register' ||
      demo.role == 'reset' ||
      demo.role == 'reset-confirm') {
    return;
  }
  final email = switch (demo.role) {
    'otp' => 'shipper@truber.zw',
    'banned-shipper' => 'banned.shipper@truber.zw',
    'banned-transporter' => 'kariba@truber.zw',
    'banned-transporter-user' => 'banned.transporter@truber.zw',
    _ => '${demo.role}@truber.zw',
  };
  s.login(email, 'demopass');
}

class TruberApp extends StatelessWidget {
  const TruberApp({super.key, this.session, this.themeController});

  final SessionController? session;
  final ThemeController? themeController;

  @override
  Widget build(BuildContext context) {
    final demo = _parseDemo();
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) {
            final s = session ?? createDefaultSession();
            s.bootstrap();
            // Demo deep links sign in with mock seed users only — never
            // against a live API.
            if (kDemoAids) {
              _signInDemo(s, demo);
            }
            return s;
          },
        ),
        ChangeNotifierProvider(
          create: (_) {
            final t = themeController ?? ThemeController();
            t.load();
            return t;
          },
        ),
      ],
      child: Consumer<ThemeController>(
        builder: (context, themes, _) {
          return MaterialApp(
            title: 'Truber',
            debugShowCheckedModeBanner: false,
            theme: TruberAppTheme.light(),
            darkTheme: TruberAppTheme.dark(),
            themeMode: themes.mode,
            home: _DemoHome(demo: demo),
          );
        },
      ),
    );
  }
}

class _DemoHome extends StatelessWidget {
  const _DemoHome({this.demo});
  final _DemoRoute? demo;

  @override
  Widget build(BuildContext context) {
    if (demo?.role == 'login') {
      return const LoginScreen();
    }
    if (demo?.role == 'register') {
      return const RegisterScreen();
    }
    if (demo?.role == 'reset') {
      return const ForgotPasswordScreen();
    }
    if (demo?.role == 'reset-confirm') {
      // Deep-link demo: token held in state only (QA-033) — never shown in UI.
      if (kDemoAids) {
        return const ResetPasswordConfirmScreen(
          token: 'demo-deep-link-reset-token-do-not-render-xxxxxxxxxxxx',
        );
      }
      return const ResetPasswordConfirmScreen();
    }
    if (kPhoneOtp && demo?.role == 'otp') {
      final session = context.watch<SessionController>();
      if (session.user == null) {
        return const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        );
      }
      return const VerifyPhoneScreen();
    }
    if (demo == null) {
      return const RoleShell();
    }
    final session = context.watch<SessionController>();
    if (session.user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return switch (demo!.role) {
      'shipper' => _ShipperDemo(tab: demo!.tab),
      'transporter' => TransporterShell(
          initialIndex: demo!.tab == 'search'
              ? 1
              : demo!.tab == 'account'
                  ? 2
                  : 0,
        ),
      'admin' => const AdminShell(),
      'banned-shipper' => const ShipperShell(),
      'banned-transporter' => const TransporterShell(),
      'banned-transporter-user' => const TransporterShell(),
      _ => const RoleShell(),
    };
  }
}

class _ShipperDemo extends StatefulWidget {
  const _ShipperDemo({this.tab});
  final String? tab;

  @override
  State<_ShipperDemo> createState() => _ShipperDemoState();
}

class _ShipperDemoState extends State<_ShipperDemo> {
  Future<Widget>? _flow;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final tab = widget.tab;
    if (_flow == null &&
        (tab == 'quotes' ||
            tab == 'payment' ||
            tab == 'payment-odd' ||
            tab == 'booking' ||
            tab == 'booking-transfer')) {
      _flow = _openFlow(tab!);
    }
  }

  Future<Widget> _openFlow(String tab) async {
    final session = context.read<SessionController>();
    final loads = await session.loads.listForCompany(MockIds.shipperCompany);
    final load = loads.firstWhere((l) => l.id == MockIds.load1);
    if (tab == 'quotes') {
      return QuotationsScreen(load: load);
    }

    final existing =
        await session.bookings.listForShipperCompany(MockIds.shipperCompany);
    late Booking booking;
    late Quotation quotation;
    final forLoad = existing.where((b) => b.loadId == load.id).toList();
    if (forLoad.isNotEmpty) {
      booking = forLoad.first;
      quotation = (await session.quotations.forLoad(load.id))
          .firstWhere((q) => q.id == booking.quotationId);
    } else {
      final quotes = await session.quotations.forLoad(load.id);
      final open =
          quotes.where((q) => q.status == QuotationStatus.submitted).toList();
      final accepted = await session.quotations.accept(open.first.id);
      booking = accepted.booking;
      quotation = accepted.quotation;
    }

    if (tab == 'payment') {
      return PaymentChoiceScreen(booking: booking, load: load);
    }
    if (tab == 'payment-odd') {
      // Demo only: odd US$0.03 total to show cent rounding of the split.
      return PaymentChoiceScreen(
        booking: booking.copyWith(
          agreedAmount: MoneyAmount(
              amountMinor: 3, currency: booking.agreedAmount.currency),
        ),
        load: load,
      );
    }

    // Seed a confirmed launch arrangement. No acknowledgement gates booking.
    final existingArr = await session.payments.latestForBooking(booking.id);
    if (existingArr == null) {
      await session.payments.propose(
        booking.id,
        CreatePaymentArrangementRequest(
          method: tab == 'booking-transfer'
              ? PaymentMethod.directTransfer
              : PaymentMethod.cash,
          totalAmount: booking.agreedAmount,
        ),
      );
    }

    return BookingConfirmScreen(
      load: load,
      booking: booking,
      quotation: quotation,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.tab == 'post') {
      return const ShipperShell(initialIndex: 2);
    }
    if (widget.tab == 'account') {
      return const ShipperShell(initialIndex: 3);
    }
    if (widget.tab == 'quotes' ||
        widget.tab == 'payment' ||
        widget.tab == 'payment-odd' ||
        widget.tab == 'booking' ||
        widget.tab == 'booking-transfer') {
      return FutureBuilder<Widget>(
        future: _flow,
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return snap.data!;
        },
      );
    }
    return const ShipperShell();
  }
}

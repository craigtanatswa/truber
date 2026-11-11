import 'dart:async';

import 'package:flutter/foundation.dart';

import '../copy/strings.dart';

import '../ui/errors/error_messages.dart';
import '../data/mock/mock_seed.dart';
import '../data/repositories/auth_repository.dart';
import '../data/repositories/booking_repository.dart';
import '../data/repositories/company_repository.dart';
import '../data/repositories/load_repository.dart';
import '../data/repositories/payment_repository.dart';
import '../data/repositories/payout_repository.dart';
import '../data/repositories/quotation_repository.dart';
import '../data/repositories/offplatform_repository.dart';
import '../models/company.dart';
import 'ban.dart';
import '../models/user.dart';

class SessionController extends ChangeNotifier {
  SessionController({
    required this.auth,
    required this.loads,
    required this.quotations,
    required this.bookings,
    required this.payments,
    this.companies,
    this.payouts,
    this.reports,
    this.companyDirectory,
    this.otpRequestsAllowed = true,
    this.enforceSessionExpiry = true,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final AuthRepository auth;
  final LoadRepository loads;
  final QuotationRepository quotations;
  final BookingRepository bookings;
  final PaymentRepository payments;

  /// Live mode: resolves the signed-in user's company from GET /companies.
  /// Null in mock mode (seed map is used instead).
  final CompanyRepository? companies;

  /// Transporter net payout source; null hides payout UI entirely.
  final PayoutRepository? payouts;

  /// Off-platform reports (POST /bookings/{id}/off-platform-reports).
  final OffPlatformReportRepository? reports;

  /// Company lookup by id (GET /companies/{id}) for ban state of the user's
  /// own company (mock) and counterparties.
  final CompanyRepository? companyDirectory;

  Company? currentCompany;
  DateTime? _serverBanUntil;
  bool _serverBanUserLevel = true;

  /// Active ban for the signed-in user or their company, if any.
  BanState? get ban => user == null
      ? null
      : computeBan(
          user: user,
          company: currentCompany,
          serverUntil: _serverBanUntil,
          serverUserLevel: _serverBanUserLevel,
          now: _clock(),
        );

  /// Records an AccountBannedError for the caller (caller / caller_company)
  /// so the home banner shows even before the next /auth/me.
  void noteServerBan(DateTime until, {required bool userLevel}) {
    _serverBanUntil = until;
    _serverBanUserLevel = userLevel;
    notifyListeners();
  }

  /// Counterparty company ban check (Company.bannedUntil). Null when unknown.
  Future<bool?> isCompanyBanned(String companyId) async {
    final dir = companyDirectory;
    if (dir == null) return null;
    try {
      return companyIsBanned(await dir.getById(companyId), _clock());
    } catch (_) {
      return null;
    }
  }

  /// False in live builds: the app never triggers real OTP delivery.
  final bool otpRequestsAllowed;

  /// Sign out when a non-refreshable (mock) access token reaches expiresIn.
  /// Widget-test fixtures that are not about expiry turn this off.
  final bool enforceSessionExpiry;

  final DateTime Function() _clock;

  /// Access-token expiry (AuthTokenResponse.expiresIn, 1800s). In mock mode
  /// the session ends here; in live mode ApiClient refreshes before it.
  DateTime? sessionExpiresAt;
  Timer? _expiryTimer;
  bool _refreshable = false;

  TruberUser? user;
  String? accessToken;
  bool bootstrapping = true;
  String? error;

  final Map<String, String> _userCompanies = Map.of(seedUserCompanies());

  /// userId → RegisterRequest.city / CreateCompanyRequest.city
  final Map<String, String> _userCities = {};

  String? companyIdFor(String userId) => _userCompanies[userId];

  String? get currentCompanyId =>
      user == null ? null : _userCompanies[user!.id];

  String? cityFor(String userId) => _userCities[userId];

  String? get currentCity => user == null ? null : _userCities[user!.id];

  Future<void> bootstrap() async {
    bootstrapping = true;
    notifyListeners();
    try {
      user = await auth.currentUser();
      if (user != null) await _resolveCompany();
    } catch (_) {
      user = null;
    }
    bootstrapping = false;
    notifyListeners();
  }

  /// [refreshable] is true when a refresh flow extends the session (live).
  void _startSession(AuthTokenResponse tokens, {bool refreshable = false}) {
    user = tokens.user;
    accessToken = tokens.accessToken;
    _refreshable = refreshable;
    sessionExpiresAt = _clock().add(Duration(seconds: tokens.expiresIn));
    _expiryTimer?.cancel();
    if (!refreshable && enforceSessionExpiry) {
      _expiryTimer =
          Timer(Duration(seconds: tokens.expiresIn), handleSessionExpired);
    }
  }

  bool get sessionRefreshable => _refreshable;

  /// Ends the session after access expiry (mock) or failed refresh (live).
  void handleSessionExpired() {
    if (user == null) return;
    _expiryTimer?.cancel();
    _expiryTimer = null;
    user = null;
    accessToken = null;
    sessionExpiresAt = null;
    error = TruberCopy.errorUnauthorized;
    currentCompany = null;
    _serverBanUntil = null;
    unawaited(auth.logout());
    notifyListeners();
  }

  Future<void> _resolveCompany() async {
    final repo = companies;
    final u = user;
    currentCompany = null;
    _serverBanUntil = null;
    if (u == null || u.role == UserRole.admin) return;
    if (repo == null) {
      final cid = _userCompanies[u.id];
      final dir = companyDirectory;
      if (cid != null && dir != null) {
        try {
          currentCompany = await dir.getById(cid);
        } catch (_) {}
      }
      return;
    }
    final want = u.role == UserRole.shipper
        ? CompanyType.shipper
        : CompanyType.transporter;
    final mine = await repo.listMine();
    for (final c in mine) {
      if (c.type == want) {
        currentCompany = c;
        _userCompanies[u.id] = c.id;
        if (c.city != null) _userCities.putIfAbsent(u.id, () => c.city!);
        return;
      }
    }
  }

  Future<bool> login(String email, String password) async {
    error = null;
    try {
      final tokens = await auth.login(email: email, password: password);
      _startSession(tokens, refreshable: companies != null);
      await _resolveCompany();
      notifyListeners();
      return true;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> register({
    required String fullName,
    required String email,
    required String password,
    required UserRole role,
    String? phone,
    String? city,
    String? organisationName,
  }) async {
    error = null;
    try {
      final tokens = await auth.register(
        email: email,
        password: password,
        fullName: fullName,
        role: role,
        phone: phone,
        city: city,
      );
      _startSession(tokens, refreshable: companies != null);
      // Mirror mock normalize: trim; empty omitted; oversize rejected by auth.
      final cityTrim = city?.trim();
      if (cityTrim != null && cityTrim.isNotEmpty && cityTrim.length <= 120) {
        _userCities[user!.id] = cityTrim;
      }
      final repo = companies;
      if (repo != null &&
          organisationName != null &&
          organisationName.trim().isNotEmpty &&
          user!.role != UserRole.admin) {
        final company = await repo.create(
          type: user!.role == UserRole.shipper
              ? CompanyType.shipper
              : CompanyType.transporter,
          legalName: organisationName.trim(),
          city: _userCities[user!.id],
        );
        _userCompanies[user!.id] = company.id;
      } else if (organisationName != null && organisationName.isNotEmpty) {
        final cid =
            '30000000-0000-4000-8000-${DateTime.now().millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}';
        _userCompanies[user!.id] = cid;
      }
      notifyListeners();
      return true;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> requestPasswordReset(String email) async {
    error = null;
    try {
      await auth.requestPasswordReset(email: email);
      notifyListeners();
      return true;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    error = null;
    try {
      await auth.confirmPasswordReset(
        token: token,
        newPassword: newPassword,
      );
      // Confirm does not issue a session (OpenAPI).
      user = null;
      accessToken = null;
      notifyListeners();
      return true;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return false;
    }
  }

  Future<OtpRequestResponse?> requestOtp({String channel = 'sms'}) async {
    error = null;
    if (!otpRequestsAllowed) {
      // Live builds never trigger OTP delivery; no fake code either.
      error = TruberCopy.errorGeneric;
      notifyListeners();
      return null;
    }
    try {
      final res = await auth.requestOtp(channel: channel);
      notifyListeners();
      return res;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return null;
    }
  }

  Future<bool> verifyOtp(String code) async {
    error = null;
    try {
      user = await auth.verifyOtp(code: code);
      notifyListeners();
      return true;
    } catch (e) {
      error = mapErrorMessage(e);
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    _expiryTimer?.cancel();
    _expiryTimer = null;
    sessionExpiresAt = null;
    await auth.logout();
    user = null;
    accessToken = null;
    currentCompany = null;
    _serverBanUntil = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    super.dispose();
  }
}

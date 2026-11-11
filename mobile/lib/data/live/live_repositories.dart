import 'dart:math';

import '../../models/company.dart';
import '../../models/load.dart';
import '../../models/user.dart';
import '../repositories/auth_repository.dart';
import '../repositories/company_repository.dart';
import '../repositories/load_repository.dart';
import 'api_client.dart';
import 'live_json.dart';

/// Random UUID v4 for Idempotency-Key headers.
String newIdempotencyKey([Random? random]) {
  final r = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  final s = List.generate(16, h).join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
}

/// Raised instead of calling POST /auth/otp/request: the app never triggers
/// real OTP delivery in live mode (no SMS/email sends from client builds).
class OtpRequestDisabledException implements Exception {
  const OtpRequestDisabledException();
  @override
  String toString() => 'OTP_REQUEST_DISABLED_IN_APP';
}

class LiveAuthRepository implements AuthRepository {
  LiveAuthRepository(this.api);
  final ApiClient api;

  @override
  Future<TruberUser?> currentUser() async {
    if (!api.tokens.hasSession) return null;
    final j = await api.get('/auth/me') as Map<String, dynamic>;
    return userFromJson(j);
  }

  AuthTokenResponse _session(dynamic body) {
    final j = body as Map<String, dynamic>;
    api.saveTokens(j);
    return tokensFromJson(j);
  }

  @override
  Future<AuthTokenResponse> login({
    required String email,
    required String password,
  }) async {
    final body = await api.post(
      '/auth/login',
      auth: false,
      body: {'email': email.trim(), 'password': password},
    );
    return _session(body);
  }

  @override
  Future<AuthTokenResponse> register({
    required String email,
    required String password,
    required String fullName,
    required UserRole role,
    String? phone,
    String? city,
  }) async {
    final cityTrim = city?.trim();
    final phoneTrim = phone?.trim();
    final body = await api.post('/auth/register', auth: false, body: {
      'email': email.trim(),
      'password': password,
      'fullName': fullName.trim(),
      'role': role.name,
      if (phoneTrim != null && phoneTrim.isNotEmpty) 'phone': phoneTrim,
      if (cityTrim != null && cityTrim.isNotEmpty) 'city': cityTrim,
    });
    return _session(body);
  }

  @override
  Future<PasswordResetRequestAccepted> requestPasswordReset({
    required String email,
  }) async {
    await api.post('/auth/password-reset/request',
        auth: false, body: {'email': email.trim()});
    return const PasswordResetRequestAccepted();
  }

  @override
  Future<PasswordResetConfirmResponse> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    await api.post('/auth/password-reset/confirm',
        auth: false, body: {'token': token, 'newPassword': newPassword});
    return const PasswordResetConfirmResponse();
  }

  @override
  Future<OtpRequestResponse> requestOtp({String channel = 'sms'}) async {
    throw const OtpRequestDisabledException();
  }

  @override
  Future<TruberUser> verifyOtp({required String code}) async {
    final j = await api.post('/auth/otp/verify', body: {'code': code})
        as Map<String, dynamic>;
    return userFromJson(j);
  }

  /// OpenAPI v0.4.0 has no logout endpoint: drop tokens locally.
  @override
  Future<void> logout() async => api.tokens.clear();
}

class LiveCompanyRepository implements CompanyRepository {
  LiveCompanyRepository(this.api);
  final ApiClient api;

  @override
  Future<List<Company>> listMine() async {
    final j = await api.get('/companies', query: {'pageSize': '100'})
        as Map<String, dynamic>;
    return (j['data'] as List)
        .map((e) => companyFromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<Company> create({
    required CompanyType type,
    required String legalName,
    String? city,
  }) async {
    final cityTrim = city?.trim();
    final j = await api.post('/companies', body: {
      'type': type.name,
      'legalName': legalName.trim(),
      if (cityTrim != null && cityTrim.isNotEmpty) 'city': cityTrim,
    }) as Map<String, dynamic>;
    return companyFromJson(j);
  }

  @override
  Future<Company> getById(String companyId) async {
    final j = await api.get('/companies/${Uri.encodeComponent(companyId)}')
        as Map<String, dynamic>;
    return companyFromJson(j);
  }
}

class LiveLoadRepository implements LoadRepository {
  LiveLoadRepository(this.api, {this.maxPages = 5});
  final ApiClient api;
  final int maxPages;

  Future<List<FreightLoad>> _list(Map<String, String> query) async {
    final out = <FreightLoad>[];
    for (var page = 1; page <= maxPages; page++) {
      final j = await api.get('/loads', query: {
        ...query,
        'page': '$page',
        'pageSize': '100',
      }) as Map<String, dynamic>;
      out.addAll((j['data'] as List)
          .map((e) => loadFromJson(e as Map<String, dynamic>)));
      final totalPages = ((j['meta'] as Map)['totalPages'] as num).toInt();
      if (page >= totalPages) break;
    }
    return out;
  }

  @override
  Future<List<FreightLoad>> listForCompany(String companyId) =>
      _list({'companyId': companyId});

  @override
  Future<List<FreightLoad>> search({
    String? pickup,
    String? destination,
    TruckType? truckType,
    int? minCapacityKg,
    DateTime? loadingDate,
  }) =>
      _list({
        if (pickup != null) 'pickupText': pickup.trim(),
        if (destination != null) 'destinationText': destination.trim(),
        if (truckType != null) 'truckTypeRequired': truckType.apiValue,
        if (minCapacityKg != null) 'minWeightKg': '$minCapacityKg',
        if (loadingDate != null) 'pickupDateFrom': apiDate(loadingDate),
        if (loadingDate != null) 'pickupDateTo': apiDate(loadingDate),
      });

  @override
  Future<FreightLoad> getById(String id) async {
    final j = await api.get('/loads/${Uri.encodeComponent(id)}')
        as Map<String, dynamic>;
    return loadFromJson(j);
  }

  @override
  Future<FreightLoad> create(CreateLoadRequest request) async {
    final j = await api.post('/loads', body: createLoadToJson(request))
        as Map<String, dynamic>;
    return loadFromJson(j);
  }

  @override
  Future<FreightLoad> post(String loadId) async {
    final j = await api.post(
      '/loads/${Uri.encodeComponent(loadId)}/post',
      headers: {'Idempotency-Key': newIdempotencyKey()},
    ) as Map<String, dynamic>;
    return loadFromJson(j);
  }
}

import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truber_app/config/flags.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/live/api_client.dart';
import 'package:truber_app/data/live/live_repositories.dart';
import 'package:truber_app/data/live/unavailable_repositories.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/quotation.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/models/load.dart';
import 'package:truber_app/state/session.dart';
import 'package:truber_app/ui/errors/error_messages.dart';

const _base = 'https://api.test.invalid';

Map<String, dynamic> _user(String role) => {
      'id': 'u-$role',
      'email': '$role@example.test',
      'fullName': 'Test $role',
      'role': role,
      'accountStatus': 'active',
      'createdAt': '2026-11-01T00:00:00Z',
      'updatedAt': '2026-11-01T00:00:00Z',
    };

Map<String, dynamic> _tokens(String access, {String role = 'shipper'}) => {
      'accessToken': access,
      'refreshToken': 'r-$access',
      'tokenType': 'Bearer',
      'expiresIn': 1800,
      'user': _user(role),
    };

Map<String, dynamic> _load(String id, {String status = 'posted'}) => {
      'id': id,
      'companyId': 'c-ship',
      'status': status,
      'goodsType': 'Maize',
      'weightKg': 30000,
      'truckTypeRequired': 'side_loader',
      'pickupAddress': 'Harare',
      'destinationAddress': 'Bulawayo',
      'loadingDate': '2026-11-20',
      'rateType': 'fixed',
      'offeredRate': {'amountMinor': 95000, 'currency': 'USD'},
      'currency': 'USD',
      'createdAt': '2026-11-01T00:00:00Z',
      'updatedAt': '2026-11-01T00:00:00Z',
    };

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json'});

void main() {
  group('build-time data mode', () {
    test('mock is the default and the fallback', () {
      expect(resolveDataMode(data: 'mock', apiBaseUrl: _base), DataMode.mock);
      expect(resolveDataMode(data: '', apiBaseUrl: _base), DataMode.mock);
      expect(resolveDataMode(data: 'live', apiBaseUrl: ''), DataMode.mock);
      expect(resolveDataMode(data: 'live', apiBaseUrl: '  '), DataMode.mock);
      expect(resolveDataMode(data: 'live', apiBaseUrl: 'not a url'),
          DataMode.mock);
      expect(resolveDataMode(data: 'live', apiBaseUrl: 'ftp://x.test'),
          DataMode.mock);
    });
    test('live needs TRUBER_DATA=live and an http(s) API_BASE_URL', () {
      expect(resolveDataMode(data: 'live', apiBaseUrl: _base), DataMode.live);
      expect(resolveDataMode(data: 'LIVE', apiBaseUrl: 'http://10.0.2.2:3000'),
          DataMode.live);
    });
    test('this test build compiled without defines is mock', () {
      expect(kApiBaseUrl, isEmpty);
      expect(kDataMode, DataMode.mock);
    });
  });

  group('ApiClient refresh (expiresIn 1800s)', () {
    test('refreshes proactively near expiry, then sends the new bearer', () {
      fakeAsync((async) {
        var now = DateTime.utc(2026, 11, 10, 10);
        final seen = <String>[];
        final client = MockClient((req) async {
          seen.add(
              '${req.method} ${req.url.path} ${req.headers['authorization'] ?? '-'}');
          if (req.url.path == '/auth/refresh') {
            expect(jsonDecode(req.body), {'refreshToken': 'r-a1'});
            return _json(_tokens('a2'));
          }
          return _json(_user('shipper'));
        });
        final api =
            ApiClient(baseUrl: _base, httpClient: client, clock: () => now);
        api.saveTokens(_tokens('a1'));
        api.get('/auth/me');
        async.flushMicrotasks();
        now = now.add(const Duration(seconds: 1750)); // inside 60s leeway
        api.get('/auth/me');
        async.flushMicrotasks();
        expect(seen, [
          'GET /auth/me Bearer a1',
          'POST /auth/refresh -',
          'GET /auth/me Bearer a2',
        ]);
        expect(
            api.tokens.accessExpiresAt, now.add(const Duration(seconds: 1800)));
      });
    });

    test('on 401 refreshes once and retries; concurrent calls share it',
        () async {
      var refreshes = 0;
      final client = MockClient((req) async {
        if (req.url.path == '/auth/refresh') {
          refreshes++;
          return _json(_tokens('fresh'));
        }
        if (req.headers['authorization'] != 'Bearer fresh') {
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }
        return _json(_user('shipper'));
      });
      final api = ApiClient(baseUrl: _base, httpClient: client);
      api.saveTokens(_tokens('stale'));
      final results =
          await Future.wait([api.get('/auth/me'), api.get('/auth/me')]);
      expect(results, hasLength(2));
      expect(refreshes, 1);
    });

    test('failed refresh clears tokens and fires onSessionExpired', () async {
      var expired = 0;
      final client = MockClient((req) async {
        if (req.url.path == '/auth/refresh') {
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }
        return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
      });
      final api = ApiClient(baseUrl: _base, httpClient: client)
        ..onSessionExpired = () => expired++;
      api.saveTokens(_tokens('a1'));
      await expectLater(api.get('/loads'), throwsA(isA<ApiException>()));
      expect(api.tokens.hasSession, isFalse);
      expect(expired, 1);
    });

    test('errors carry OpenAPI Error.code and map to Design copy', () async {
      final api = ApiClient(
          baseUrl: _base,
          httpClient: MockClient((_) async =>
              _json({'code': 'INVALID_CREDENTIALS', 'message': 'no'}, 401)));
      final auth = LiveAuthRepository(api);
      try {
        await auth.login(email: 'a@b.test', password: 'whatever1');
        fail('should throw');
      } on ApiException catch (e) {
        expect(e.code, 'INVALID_CREDENTIALS');
        expect(mapErrorMessage(e), TruberCopy.loginErrorCredentials);
      }
      expect(mapErrorMessage(ApiException(503, 'HTTP_503')),
          TruberCopy.errorServer);
      expect(mapErrorMessage(ApiException(409, 'ACCOUNT_BANNED')),
          TruberCopy.errorForbidden);
      expect(mapErrorMessage(ApiException(403, 'VERIFICATION_REQUIRED')),
          TruberCopy.errorForbidden);
    });
  });

  group('live repositories', () {
    test('login posts LoginRequest and stores tokens', () async {
      late http.Request sent;
      final api = ApiClient(
          baseUrl: '$_base/',
          httpClient: MockClient((req) async {
            sent = req;
            return _json(_tokens('a1'));
          }));
      final t = await LiveAuthRepository(api)
          .login(email: ' a@b.test ', password: 'pw-from-user');
      expect(sent.url.toString(), '$_base/auth/login');
      expect(sent.headers['authorization'], isNull);
      expect(jsonDecode(sent.body),
          {'email': 'a@b.test', 'password': 'pw-from-user'});
      expect(t.expiresIn, 1800);
      expect(api.tokens.accessToken, 'a1');
    });

    test('requestOtp never calls the API in live mode', () async {
      var calls = 0;
      final api = ApiClient(
          baseUrl: _base,
          httpClient: MockClient((_) async {
            calls++;
            return _json({});
          }));
      await expectLater(LiveAuthRepository(api).requestOtp(),
          throwsA(isA<OtpRequestDisabledException>()));
      expect(calls, 0);
    });

    test('search maps filters to listLoads query and follows pages', () async {
      final queries = <Map<String, String>>[];
      final api = ApiClient(
          baseUrl: _base,
          httpClient: MockClient((req) async {
            queries.add(req.url.queryParameters);
            final page = int.parse(req.url.queryParameters['page']!);
            return _json({
              'data': [_load('l$page', status: 'booking_pending')],
              'meta': {
                'page': page,
                'pageSize': 100,
                'totalItems': 2,
                'totalPages': 2
              },
            });
          }));
      api.saveTokens(_tokens('a1'));
      final loads = await LiveLoadRepository(api).search(
        pickup: 'Harare',
        truckType: TruckType.sideLoader,
        minCapacityKg: 1000,
        loadingDate: DateTime(2026, 11, 20),
      );
      expect(loads.map((l) => l.id), ['l1', 'l2']);
      expect(loads.first.status, LoadStatus.bookingPending);
      expect(loads.first.truckTypeRequired, TruckType.sideLoader);
      expect(loads.first.offeredRate!.amountMinor, 95000);
      expect(queries.first, {
        'pickupText': 'Harare',
        'truckTypeRequired': 'side_loader',
        'minWeightKg': '1000',
        'pickupDateFrom': '2026-11-20',
        'pickupDateTo': '2026-11-20',
        'page': '1',
        'pageSize': '100',
      });
    });

    test('create sends CreateLoadRequest; post sends an Idempotency-Key',
        () async {
      final sent = <http.Request>[];
      final api = ApiClient(
          baseUrl: _base,
          httpClient: MockClient((req) async {
            sent.add(req);
            return _json(
                _load('l1',
                    status:
                        req.url.path.endsWith('/post') ? 'posted' : 'draft'),
                201);
          }));
      api.saveTokens(_tokens('a1'));
      final repo = LiveLoadRepository(api);
      await repo.create(CreateLoadRequest(
        companyId: 'c-ship',
        goodsType: 'Maize',
        weightKg: 30000,
        truckTypeRequired: TruckType.flatbed,
        pickupAddress: 'Harare',
        destinationAddress: 'Mutare',
        loadingDate: DateTime(2026, 11, 20),
        rateType: RateType.negotiable,
        currency: 'USD',
      ));
      expect(jsonDecode(sent[0].body), {
        'companyId': 'c-ship',
        'goodsType': 'Maize',
        'weightKg': 30000,
        'truckTypeRequired': 'flatbed',
        'pickupAddress': 'Harare',
        'destinationAddress': 'Mutare',
        'loadingDate': '2026-11-20',
        'rateType': 'negotiable',
        'currency': 'USD',
      });
      final posted = await repo.post('l1');
      expect(posted.status, LoadStatus.posted);
      expect(sent[1].url.path, '/loads/l1/post');
      expect(
          sent[1].headers['idempotency-key'],
          matches(RegExp(
              r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
    });
  });

  test('live quotations fail visibly instead of faking success', () async {
    final repo = UnavailableQuotationRepository();
    final e = await repo
        .submit(
            'live-load',
            CreateQuotationRequest(
              transporterCompanyId: 'c-tr',
              amount: const MoneyAmount(amountMinor: 1, currency: 'USD'),
              validUntil: DateTime(2026, 12, 1),
            ))
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(e, isA<ApiException>());
    expect(mapErrorMessage(e!), TruberCopy.errorServer);
  });

  group('session', () {
    test('live login resolves the company from GET /companies', () async {
      final api = ApiClient(
          baseUrl: _base,
          httpClient: MockClient((req) async {
            if (req.url.path == '/auth/login') {
              return _json(_tokens('a1', role: 'transporter'));
            }
            if (req.url.path == '/companies') {
              return _json({
                'data': [
                  {
                    'id': 'c-tr',
                    'type': 'transporter',
                    'legalName': 'Haulage Test',
                    'verificationStatus': 'verified',
                    'city': 'Gweru',
                    'createdAt': '2026-11-01T00:00:00Z',
                    'updatedAt': '2026-11-01T00:00:00Z',
                  }
                ],
                'meta': {
                  'page': 1,
                  'pageSize': 100,
                  'totalItems': 1,
                  'totalPages': 1
                },
              });
            }
            return _json({}, 404);
          }));
      final s = SessionController(
        auth: LiveAuthRepository(api),
        companies: LiveCompanyRepository(api),
        loads: LiveLoadRepository(api),
        quotations: MockQuotationRepository(loads: MockLoadRepository()),
        bookings: MockBookingRepository(),
        payments: MockPaymentRepository(),
        otpRequestsAllowed: false,
      );
      expect(await s.login('t@example.test', 'pw-from-user'), isTrue);
      expect(s.currentCompanyId, 'c-tr');
      expect(s.currentCity, 'Gweru');
      expect(s.sessionRefreshable, isTrue);
      expect(await s.requestOtp(), isNull);
      s.dispose();
    });

    test('mock session ends after expiresIn (1800s) with error.unauthorized',
        () {
      fakeAsync((async) {
        final loads = MockLoadRepository();
        final s = SessionController(
          auth: MockAuthRepository(),
          loads: loads,
          quotations: MockQuotationRepository(loads: loads),
          bookings: MockBookingRepository(),
          payments: MockPaymentRepository(),
        );
        s.login('shipper@truber.zw', 'demopass');
        async.flushMicrotasks();
        expect(s.user, isNotNull);
        async.elapse(const Duration(seconds: 1799));
        expect(s.user, isNotNull);
        async.elapse(const Duration(seconds: 2));
        expect(s.user, isNull);
        expect(s.error, TruberCopy.errorUnauthorized);
        s.dispose();
      });
    });
  });
}

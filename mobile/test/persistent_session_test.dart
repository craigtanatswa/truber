import 'dart:async';
import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:truber_app/app.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/live/api_client.dart';
import 'package:truber_app/data/live/refresh_coordination.dart';
import 'package:truber_app/data/live/refresh_token_vault.dart';
import 'package:truber_app/data/mock/mock_auth_repository.dart';
import 'package:truber_app/data/mock/mock_booking_repository.dart';
import 'package:truber_app/data/mock/mock_load_repository.dart';
import 'package:truber_app/data/mock/mock_payment_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/models/user.dart';
import 'package:truber_app/state/session.dart';

const _base = 'https://api.test.invalid';

class RecordingRefreshTokenVault extends MemoryRefreshTokenVault {
  RecordingRefreshTokenVault([super.value]);

  final writes = <String>[];

  @override
  Future<void> write(String refreshToken) async {
    writes.add(refreshToken);
    await super.write(refreshToken);
  }
}

Map<String, dynamic> _user(String role) => {
      'id': 'u-$role',
      'email': '$role@example.test',
      'fullName': 'Test $role',
      'role': role,
      'accountStatus': 'active',
      'createdAt': '2026-11-01T00:00:00Z',
      'updatedAt': '2026-11-01T00:00:00Z',
    };

Map<String, dynamic> _tokenBody({
  required String access,
  required String refresh,
  int expiresIn = 1800,
  String role = 'shipper',
}) =>
    {
      'accessToken': access,
      'refreshToken': refresh,
      'tokenType': 'Bearer',
      'expiresIn': expiresIn,
      'user': _user(role),
    };

Map<String, dynamic> _companies(String role) => {
      'data': [
        {
          'id': 'c-$role',
          'type': role,
          'legalName': 'Test $role',
          'verificationStatus': 'unverified',
          'city': 'Harare',
          'createdAt': '2026-11-01T00:00:00Z',
          'updatedAt': '2026-11-01T00:00:00Z',
        }
      ],
      'meta': {'page': 1, 'pageSize': 100, 'totalItems': 1, 'totalPages': 1},
    };

Map<String, dynamic> _emptyPage() => {
      'data': <Object>[],
      'meta': {'page': 1, 'pageSize': 100, 'totalItems': 0, 'totalPages': 1},
    };

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('token store', () {
    test('persists the refresh token and keeps the access token in memory',
        () async {
      final vault = RecordingRefreshTokenVault();
      final api = ApiClient(baseUrl: _base, refreshTokens: vault);
      await api.saveTokens(_tokenBody(
        access: 'access-aaa',
        refresh: 'refresh-rrr',
        expiresIn: 1200,
      ));
      expect(await vault.read(), 'refresh-rrr');
      expect(vault.writes, ['refresh-rrr']);
      expect(api.tokens.accessToken, 'access-aaa');
      expect(api.tokens.toString(), isNot(contains('access-aaa')));
      expect(api.tokens.toString(), isNot(contains('refresh-rrr')));

      final restarted = ApiClient(baseUrl: _base, refreshTokens: vault);
      expect(restarted.tokens.accessToken, isNull);
      expect(await restarted.tokens.vault.read(), 'refresh-rrr');
    });

    test('clear wipes the stored refresh token', () async {
      final vault = RecordingRefreshTokenVault('refresh-rrr');
      final api = ApiClient(baseUrl: _base, refreshTokens: vault);
      api.tokens.apply(
        access: 'access-aaa',
        refresh: 'refresh-rrr',
        expiresInSeconds: 90,
        now: DateTime.utc(2026, 11, 10),
      );
      await api.tokens.clear();
      expect(await vault.read(), isNull);
      expect(api.tokens.accessToken, isNull);
      expect(api.tokens.refreshToken, isNull);
      expect(api.tokens.hasSession, isFalse);
    });
  });

  group('refresh interceptor', () {
    test('refreshes from expiresIn, not a fixed lifetime', () {
      fakeAsync((async) {
        var now = DateTime.utc(2026, 11, 10, 12);
        var refreshes = 0;
        final api = ApiClient(
          baseUrl: _base,
          clock: () => now,
          httpClient: MockClient((req) async {
            if (req.url.path == '/auth/refresh') {
              refreshes++;
              expect(jsonDecode(req.body), {'refreshToken': 'refresh-a'});
              return _json(_tokenBody(
                access: 'access-b',
                refresh: 'refresh-b',
                expiresIn: 90,
              ));
            }
            return _json(_user('shipper'));
          }),
        );
        api.saveTokens(_tokenBody(
          access: 'access-a',
          refresh: 'refresh-a',
          expiresIn: 90,
        ));
        api.get('/auth/me');
        async.flushMicrotasks();
        expect(refreshes, 0);

        now = now.add(const Duration(seconds: 29));
        api.get('/auth/me');
        async.flushMicrotasks();
        expect(refreshes, 0);

        now = now.add(const Duration(seconds: 1));
        api.get('/auth/me');
        async.flushMicrotasks();
        expect(refreshes, 1);
        expect(api.tokens.accessToken, 'access-b');
        expect(
          api.tokens.accessExpiresAt,
          now.add(const Duration(seconds: 90)),
        );
      });
    });

    test('401 refreshes once, retries once, and stores the rotated token',
        () async {
      final vault = RecordingRefreshTokenVault();
      var refreshes = 0;
      final api = ApiClient(
        baseUrl: _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            refreshes++;
            expect(jsonDecode(req.body), {'refreshToken': 'refresh-stale'});
            return _json(_tokenBody(
              access: 'access-fresh',
              refresh: 'refresh-fresh',
              expiresIn: 600,
            ));
          }
          if (req.headers['authorization'] != 'Bearer access-fresh') {
            return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
          }
          return _json(_user('shipper'));
        }),
      );
      await api.saveTokens(_tokenBody(
        access: 'access-stale',
        refresh: 'refresh-stale',
        expiresIn: 600,
      ));
      final me = await api.get('/auth/me') as Map<String, dynamic>;
      expect(me['role'], 'shipper');
      expect(refreshes, 1);
      expect(await vault.read(), 'refresh-fresh');
      expect(
        api.tokens.accessExpiresAt!.difference(api.now()).inSeconds,
        inInclusiveRange(590, 600),
      );
    });

    test('N concurrent 401s make exactly one /auth/refresh call', () async {
      final vault = RecordingRefreshTokenVault();
      var refreshes = 0;
      final api = ApiClient(
        baseUrl: _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            refreshes++;
            return _json(_tokenBody(
              access: 'access-fresh',
              refresh: 'refresh-fresh',
            ));
          }
          if (req.headers['authorization'] != 'Bearer access-fresh') {
            return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
          }
          return _json(_user('shipper'));
        }),
      );
      await api.saveTokens(_tokenBody(
        access: 'access-stale',
        refresh: 'refresh-stale',
      ));
      final results = await Future.wait(
        List.generate(5, (_) => api.get('/auth/me')),
      );
      expect(results, hasLength(5));
      expect(refreshes, 1);
      expect(await vault.read(), 'refresh-fresh');
      expect(vault.writes.contains('access-fresh'), isFalse);
      expect(vault.writes.contains('access-stale'), isFalse);
    });

    test('refresh 401 with no newer token logs out and wipes storage',
        () async {
      final vault = RecordingRefreshTokenVault();
      var expired = 0;
      var refreshes = 0;
      final api = ApiClient(
        baseUrl: _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') refreshes++;
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }),
      )..onSessionExpired = () => expired++;
      await api.saveTokens(
          _tokenBody(access: 'access-a', refresh: 'refresh-a'));
      await expectLater(api.get('/loads'), throwsA(isA<ApiException>()));
      expect(refreshes, 1);
      expect(expired, 1);
      expect(await vault.read(), isNull);
      expect(api.tokens.hasSession, isFalse);
      expect(api.tokens.refreshToken, isNull);
    });

    test(
        'refresh 401 then a newer token in storage succeeds without logout',
        () async {
      final vault = RecordingRefreshTokenVault('refresh-old');
      var expired = 0;
      final sent = <String>[];
      final api = ApiClient(
        baseUrl: _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            final token =
                (jsonDecode(req.body) as Map)['refreshToken'] as String;
            sent.add(token);
            if (token == 'refresh-old') {
              await vault.write('refresh-peer');
              return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
            }
            return _json(_tokenBody(
              access: 'access-new',
              refresh: 'refresh-rotated',
              expiresIn: 1200,
              role: 'transporter',
            ));
          }
          if (req.headers['authorization'] == 'Bearer access-new') {
            return _json(_user('transporter'));
          }
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }),
      )..onSessionExpired = () => expired++;
      api.tokens.apply(
        access: 'access-stale',
        refresh: 'refresh-old',
        expiresInSeconds: 500,
        now: DateTime.utc(2026, 11, 10),
      );
      final me = await api.get('/auth/me') as Map<String, dynamic>;
      expect(me['role'], 'transporter');
      expect(expired, 0);
      expect(sent, ['refresh-old', 'refresh-peer']);
      expect(await vault.read(), 'refresh-rotated');
      expect(api.tokens.accessToken, 'access-new');
      expect(api.tokens.hasSession, isTrue);
      expect(vault.writes.contains('access-new'), isFalse);
      expect(vault.writes.contains('access-stale'), isFalse);
    });
  });

  group('cross-tab lock', () {
    test('only one tab holds the refresh lock', () {
      final board = SharedTabBoard();
      var now = DateTime.utc(2026, 1, 1);
      final a = CoordinatedRefreshVault(
        board.open(),
        ownerId: 'tab-a',
        clock: () => now,
      );
      final b = CoordinatedRefreshVault(
        board.open(),
        ownerId: 'tab-b',
        clock: () => now,
      );
      expect(a.tryAcquire(), isTrue);
      expect(b.tryAcquire(), isFalse);
      now = now.add(const Duration(seconds: 11));
      expect(b.tryAcquire(), isTrue);
    });

    test('lock value is not a token, and a waiter sees the rotated token',
        () async {
      final board = SharedTabBoard();
      final a = CoordinatedRefreshVault(board.open(), ownerId: 'tab-a');
      final b = CoordinatedRefreshVault(board.open(), ownerId: 'tab-b');
      await a.write('refresh-secret');
      expect(a.tryAcquire(), isTrue);
      expect(
        board.data[CoordinatedRefreshVault.lockKey],
        isNot(contains('refresh-secret')),
      );
      expect(board.data[CoordinatedRefreshVault.tokenKey], 'refresh-secret');
      expect(
        board.data.values.any((value) => value.contains('access-')),
        isFalse,
      );

      final pending = b.claimRefresh('refresh-secret');
      await a.write('refresh-peer');
      await a.finishRefresh();
      expect(
        await pending.timeout(const Duration(seconds: 2)),
        'refresh-peer',
      );
      expect(board.data[CoordinatedRefreshVault.tokenKey], 'refresh-peer');
    });

    test('a peer rotation is presented instead of the stale token', () async {
      final board = SharedTabBoard();
      final vault = CoordinatedRefreshVault(board.open(), ownerId: 'tab-b');
      await vault.write('refresh-old');
      final peer = CoordinatedRefreshVault(board.open(), ownerId: 'tab-a');
      await peer.write('refresh-peer');

      final sent = <String>[];
      final api = ApiClient(
        baseUrl: _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') {
            sent.add((jsonDecode(req.body) as Map)['refreshToken'] as String);
            return _json(_tokenBody(
              access: 'access-new',
              refresh: 'refresh-rotated',
            ));
          }
          if (req.headers['authorization'] == 'Bearer access-new') {
            return _json(_user('shipper'));
          }
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }),
      );
      api.tokens.apply(
        access: 'access-stale',
        refresh: 'refresh-old',
        expiresInSeconds: 500,
        now: DateTime.utc(2026, 11, 10),
      );
      await api.get('/auth/me');
      expect(sent, ['refresh-peer']);
      expect(await vault.read(), 'refresh-rotated');
    });
  });

  group('session restore', () {
    test('cold start refreshes, then /auth/me, and does not store access',
        () async {
      final vault = RecordingRefreshTokenVault('refresh-stored');
      final paths = <String>[];
      final session = createLiveSession(
        _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          paths.add('${req.method} ${req.url.path}');
          if (req.url.path == '/auth/refresh') {
            expect(jsonDecode(req.body), {'refreshToken': 'refresh-stored'});
            return _json(_tokenBody(
              access: 'access-live',
              refresh: 'refresh-live',
            ));
          }
          if (req.url.path == '/auth/me') {
            expect(req.headers['authorization'], 'Bearer access-live');
            return _json(_user('shipper'));
          }
          if (req.url.path == '/companies') return _json(_companies('shipper'));
          return _json({'code': 'NOT_FOUND'}, 404);
        }),
      );
      await session.bootstrap();
      expect(paths, [
        'POST /auth/refresh',
        'GET /auth/me',
        'GET /companies',
      ]);
      expect(session.user?.role, UserRole.shipper);
      expect(session.bootstrapping, isFalse);
      expect(session.sessionRefreshable, isTrue);
      expect(await vault.read(), 'refresh-live');
      expect(vault.writes.contains('access-live'), isFalse);
      session.dispose();
    });

    test('cold start refresh 401 wipes storage and leaves the user signed out',
        () async {
      final vault = RecordingRefreshTokenVault('refresh-dead');
      var refreshes = 0;
      final session = createLiveSession(
        _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') refreshes++;
          return _json({'code': 'UNAUTHORIZED', 'message': 'x'}, 401);
        }),
      );
      await session.bootstrap();
      expect(session.user, isNull);
      expect(session.bootstrapping, isFalse);
      expect(refreshes, 1);
      expect(await vault.read(), isNull);
      session.dispose();
    });

    test('logout wipes storage', () async {
      final vault = RecordingRefreshTokenVault();
      final session = createLiveSession(
        _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/login') {
            return _json(_tokenBody(
              access: 'access-live',
              refresh: 'refresh-live',
            ));
          }
          if (req.url.path == '/companies') return _json(_companies('shipper'));
          return _json({'code': 'NOT_FOUND'}, 404);
        }),
      );
      expect(
          await session.login('shipper@example.test', 'password1'), isTrue);
      expect(await vault.read(), 'refresh-live');
      await session.logout();
      expect(session.user, isNull);
      expect(await vault.read(), isNull);
      session.dispose();
    });

    test('mock mode still signs in without a refresh vault', () async {
      final loads = MockLoadRepository();
      final session = SessionController(
        auth: MockAuthRepository(),
        loads: loads,
        quotations: MockQuotationRepository(loads: loads),
        bookings: MockBookingRepository(),
        payments: MockPaymentRepository(),
      );
      await session.bootstrap();
      expect(session.user, isNull);
      expect(session.bootstrapping, isFalse);
      expect(await session.login('shipper@truber.zw', 'demopass'), isTrue);
      expect(session.sessionRefreshable, isFalse);
      expect(session.user?.role, UserRole.shipper);
      session.dispose();
    });
  });

  group('cold start widgets', () {
    testWidgets(
        'stored refresh token shows a splash then the shipper home; logout restart is welcome',
        (tester) async {
      final vault = RecordingRefreshTokenVault('refresh-stored');
      final gate = Completer<void>();
      var refreshes = 0;
      final session = createLiveSession(
        _base,
        refreshTokens: vault,
        httpClient: MockClient(
          (req) => _roleApi(req, 'shipper', gate: gate, onRefresh: () {
            refreshes++;
          }),
        ),
      );

      await tester.pumpWidget(TruberApp(session: session));
      await tester.pump();
      expect(find.byKey(const Key('session_splash')), findsOneWidget);
      expect(find.text(TruberCopy.getStarted), findsNothing);
      expect(find.text(TruberCopy.tagline), findsNothing);
      expect(find.text(TruberCopy.loginCta), findsNothing);

      gate.complete();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('nav_shipper_home')), findsOneWidget);
      expect(find.text(TruberCopy.shipperHomeTitle), findsOneWidget);
      expect(find.byKey(const Key('session_splash')), findsNothing);
      expect(await vault.read(), 'refresh-live');
      expect(vault.writes.contains('access-live'), isFalse);
      expect(refreshes, 1);

      await tester.tap(find.byKey(const Key('nav_shipper_account')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('logout_button')));
      await tester.tap(find.byKey(const Key('logout_button')));
      await tester.pumpAndSettle();
      expect(find.text(TruberCopy.getStarted), findsOneWidget);
      expect(find.text(TruberCopy.tagline), findsOneWidget);
      expect(await vault.read(), isNull);

      var restartedRefreshes = 0;
      final restarted = createLiveSession(
        _base,
        refreshTokens: vault,
        httpClient: MockClient((req) async {
          if (req.url.path == '/auth/refresh') restartedRefreshes++;
          return _json({'code': 'NOT_FOUND'}, 404);
        }),
      );
      await tester.pumpWidget(TruberApp(session: restarted));
      await tester.pumpAndSettle();
      expect(find.text(TruberCopy.getStarted), findsOneWidget);
      expect(find.byKey(const Key('nav_shipper_home')), findsNothing);
      expect(restartedRefreshes, 0);
    });

    testWidgets('stored transporter token lands on the transporter home',
        (tester) async {
      await _expectRoleHome(
        tester,
        role: 'transporter',
        homeKey: const Key('nav_transporter_home'),
        title: TruberCopy.transporterHomeTitle,
      );
    });

    testWidgets('stored admin token lands on the admin home', (tester) async {
      await _expectRoleHome(
        tester,
        role: 'admin',
        homeKey: const Key('nav_admin_home'),
        title: TruberCopy.adminPlaceholder,
      );
    });
  });
}

Future<http.Response> _roleApi(
  http.Request req,
  String role, {
  Completer<void>? gate,
  void Function()? onRefresh,
}) async {
  if (gate != null && !gate.isCompleted) await gate.future;
  if (req.url.path == '/auth/refresh') {
    onRefresh?.call();
    expect(jsonDecode(req.body), {'refreshToken': 'refresh-stored'});
    return _json(_tokenBody(
      access: 'access-live',
      refresh: 'refresh-live',
      role: role,
    ));
  }
  if (req.url.path == '/auth/me') {
    expect(req.headers['authorization'], 'Bearer access-live');
    return _json(_user(role));
  }
  if (req.url.path == '/companies') {
    if (role == 'admin') {
      return _json({
        'data': <Object>[],
        'meta': {'page': 1, 'pageSize': 100, 'totalItems': 0, 'totalPages': 1},
      });
    }
    return _json(_companies(role));
  }
  if (req.url.path == '/loads') return _json(_emptyPage());
  return _json({'code': 'NOT_FOUND', 'message': req.url.path}, 404);
}

Future<void> _expectRoleHome(
  WidgetTester tester, {
  required String role,
  required Key homeKey,
  required String title,
}) async {
  final vault = RecordingRefreshTokenVault('refresh-stored');
  final session = createLiveSession(
    _base,
    refreshTokens: vault,
    httpClient: MockClient((req) => _roleApi(req, role)),
  );
  await tester.pumpWidget(TruberApp(session: session));
  await tester.pumpAndSettle();
  expect(find.byKey(homeKey), findsOneWidget);
  expect(find.text(title), findsOneWidget);
  expect(find.text(TruberCopy.getStarted), findsNothing);
  expect(await vault.read(), 'refresh-live');
  expect(vault.writes.contains('access-live'), isFalse);
}

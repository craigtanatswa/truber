import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:truber_app/copy/strings.dart';
import 'package:truber_app/data/live/api_client.dart';
import 'package:truber_app/data/live/live_json.dart';
import 'package:truber_app/data/live/live_quotation_repository.dart';
import 'package:truber_app/data/mock/mock_quotation_repository.dart';
import 'package:truber_app/models/money.dart';
import 'package:truber_app/models/quotation.dart';
import 'package:truber_app/ui/errors/error_messages.dart';
import 'package:truber_app/ui/format/dates.dart';

const _loadId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const _quoteId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const _companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const _bookingId = '44444444-4444-4444-8444-444444444441';

Map<String, dynamic> _quote({String status = 'submitted', String? id}) => {
      'id': id ?? _quoteId,
      'loadId': _loadId,
      'transporterCompanyId': _companyId,
      'truckId': null,
      'amount': {'amountMinor': 95000, 'currency': 'USD'},
      'status': status,
      'notes': 'Can load Tuesday morning.',
      'validUntil': '2026-11-10T00:00:00.000Z',
      'createdAt': '2026-11-06T12:00:00.000Z',
      'updatedAt': '2026-11-06T12:00:00.000Z',
      'counterpartyRestrictedUntil': null,
    };

Map<String, dynamic> _booking() => {
      'id': _bookingId,
      'loadId': _loadId,
      'quotationId': _quoteId,
      'shipperCompanyId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'transporterCompanyId': _companyId,
      'truckId': null,
      'status': 'pending_payment_arrangement',
      'tripStatus': 'not_started',
      'completionStatus': 'not_complete',
      'agreedAmount': {'amountMinor': 95000, 'currency': 'USD'},
      'commissionRateBps': 500,
      'confirmedPaymentArrangementId': null,
      'confirmedAt': null,
      'createdAt': '2026-11-06T12:00:00.000Z',
      'updatedAt': '2026-11-06T12:00:00.000Z',
    };

Map<String, dynamic> _list(List<Map<String, dynamic>> data,
        {int page = 1, int totalPages = 1}) =>
    {
      'data': data,
      'meta': {
        'page': page,
        'pageSize': 100,
        'totalItems': data.length,
        'totalPages': totalPages,
      },
    };

Map<String, dynamic> _preview({
  int agreed = 100000,
  int commission = 5000,
  int net = 95000,
  String feeStatus = 'unknown',
  String? paymentMethod = 'prepay',
  bool fare = true,
  bool protected = true,
  List<Map<String, dynamic>> blockers = const [],
}) =>
    {
      'agreedAmount': {'amountMinor': agreed, 'currency': 'USD'},
      'commissionRateBps': 500,
      'commissionAmount': {'amountMinor': commission, 'currency': 'USD'},
      'knownFees': const [],
      'knownFeesTotal': {'amountMinor': 0, 'currency': 'USD'},
      'netPayoutBeforeUnknownFees': {'amountMinor': net, 'currency': 'USD'},
      'feeStatus': feeStatus,
      'unknownFees': feeStatus == 'unknown'
          ? [
              {
                'feeType': 'processing_fee',
                'reason': 'provider_not_contracted',
              }
            ]
          : const [],
      'paymentMethod': paymentMethod,
      'farePayoutDueThroughTruber': fare,
      'paymentProtectedPossible': protected,
      'submissionBlockers': blockers,
    };

Map<String, dynamic> _banned({String party = 'caller'}) => {
      'code': 'ACCOUNT_BANNED',
      'message': 'This account is temporarily banned from new work on Truber.',
      'details': {
        'bannedUntil': '2026-11-24T09:00:00Z',
        'bannedParty': party,
      },
    };

Map<String, dynamic> _commission({bool twoCurrencies = false}) => {
      'code': 'COMMISSION_OUTSTANDING',
      'message':
          'Outstanding commission must be settled before taking new work.',
      'details': twoCurrencies
          ? {
              'outstandingByCurrency': [
                {'amountMinor': 1500, 'currency': 'USD'},
                {'amountMinor': 40000, 'currency': 'ZWG'},
              ],
            }
          : {
              'outstandingAmount': {'amountMinor': 1500, 'currency': 'USD'},
              'outstandingByCurrency': [
                {'amountMinor': 1500, 'currency': 'USD'},
              ],
            },
    };

Map<String, dynamic> _error(String code, String message,
        [Map<String, dynamic>? details]) =>
    {
      'code': code,
      'message': message,
      if (details != null) 'details': details,
    };

http.Response _json(Object body, [int status = 200]) => http.Response(
    jsonEncode(body), status,
    headers: {'content-type': 'application/json'});

class _Hit {
  _Hit(this.request);
  final http.Request request;
}

LiveQuotationRepository _repo(
  http.Response Function(http.Request req) handle,
  List<_Hit> hits,
) {
  final api = ApiClient(
    baseUrl: 'http://127.0.0.1:9',
    httpClient: MockClient((req) async {
      hits.add(_Hit(req));
      return handle(req);
    }),
  );
  api.saveTokens({
    'accessToken': 'access-token',
    'refreshToken': 'refresh-token',
    'expiresIn': 1800,
  });
  return LiveQuotationRepository(api);
}

Future<ApiException> _capture(Future<Object?> future) async {
  try {
    await future;
  } on ApiException catch (e) {
    return e;
  }
  fail('expected ApiException');
}

void main() {
  test('quotation payload ignores payout and commission fields', () {
    final q = quotationFromJson({
      ..._quote(),
      'commissionAmount': {'amountMinor': 4750, 'currency': 'USD'},
      'netPayoutBeforeUnknownFees': {'amountMinor': 90250, 'currency': 'USD'},
      'paymentProtectedPossible': true,
    });
    expect(q.amount.amountMinor, 95000);
    expect(q.amount.currency, 'USD');
    expect(q.counterpartyRestrictedUntil, isNull);
  });

  test('counterpartyRestrictedUntil parses as a date only', () {
    final q = quotationFromJson({
      ..._quote(),
      'counterpartyRestrictedUntil': '2026-11-24T09:00:00Z',
    });
    expect(q.counterpartyRestrictedUntil, DateTime.utc(2026, 11, 24, 9));
    expect(q.counterpartyRestrictedAt(DateTime.utc(2026, 11, 24, 8)), isTrue);
    expect(q.counterpartyRestrictedAt(DateTime.utc(2026, 11, 24, 9)), isFalse);
  });

  test('mock payout preview matches v0.5.0 half-up examples', () async {
    final repo = MockQuotationRepository();
    final plain = await repo.previewPayout(const PayoutPreviewRequest(
      transporterCompanyId: _companyId,
      amount: MoneyAmount(amountMinor: 100000, currency: 'USD'),
    ));
    expect(plain.commissionRateBps, 500);
    expect(plain.commissionAmount.amountMinor, 5000);
    expect(plain.knownFeesTotal.amountMinor, 0);
    expect(plain.netPayoutBeforeUnknownFees.amountMinor, 95000);
    expect(plain.feeStatus, 'unknown');
    expect(plain.paymentMethod, isNull);
    expect(plain.farePayoutDueThroughTruber, isTrue);
    expect(plain.paymentProtectedPossible, isTrue);
    expect(plain.submissionBlockers, isEmpty);

    final odd = await repo.previewPayout(const PayoutPreviewRequest(
      transporterCompanyId: _companyId,
      amount: MoneyAmount(amountMinor: 25010, currency: 'USD'),
    ));
    expect(odd.commissionAmount.amountMinor, 1251);
    expect(odd.netPayoutBeforeUnknownFees.amountMinor, 23759);

    final cash = await repo.previewPayout(const PayoutPreviewRequest(
      transporterCompanyId: _companyId,
      amount: MoneyAmount(amountMinor: 50000, currency: 'USD'),
      paymentMethod: 'cash',
    ));
    expect(cash.feeStatus, 'not_applicable');
    expect(cash.farePayoutDueThroughTruber, isFalse);
    expect(cash.paymentProtectedPossible, isFalse);
    expect(cash.commissionAmount.amountMinor, 2500);
    expect(cash.netPayoutBeforeUnknownFees.amountMinor, 47500);
  });

  group('live success', () {
    test('list pages, get, and drops nothing the shipper model can show',
        () async {
      final hits = <_Hit>[];
      final repo = _repo((req) {
        if (req.url.path == '/loads/$_loadId/quotations' &&
            req.url.queryParameters['page'] == '1') {
          return _json(_list([_quote()], totalPages: 2));
        }
        if (req.url.path == '/loads/$_loadId/quotations') {
          return _json(_list([
            _quote(id: 'ffffffff-ffff-4fff-8fff-fffffffffffe', status: 'withdrawn')
          ], page: 2));
        }
        return _json(_quote());
      }, hits);
      final listed = await repo.forLoad(_loadId);
      expect(listed, hasLength(2));
      expect(listed.last.status.name, 'withdrawn');
      final one = await repo.getById(_quoteId);
      expect(one.id, _quoteId);
      expect(one.amount.display, r'US$950.00');
      expect(hits[2].request.url.path, '/quotations/$_quoteId');
    });

    test('create sends the contract body and an idempotency key', () async {
      final hits = <_Hit>[];
      final repo = _repo((_) => _json(_quote(), 201), hits);
      final until = DateTime.utc(2026, 11, 20, 8);
      final created = await repo.submit(
        _loadId,
        CreateQuotationRequest(
          transporterCompanyId: _companyId,
          amount: const MoneyAmount(amountMinor: 95000, currency: 'USD'),
          validUntil: until,
          notes: 'Tuesday',
        ),
      );
      expect(created.status.name, 'submitted');
      final req = hits.single.request;
      expect(req.method, 'POST');
      expect(req.url.path, '/loads/$_loadId/quotations');
      expect(req.headers['idempotency-key'], isNotNull);
      expect(jsonDecode(req.body), {
        'transporterCompanyId': _companyId,
        'amount': {'amountMinor': 95000, 'currency': 'USD'},
        'notes': 'Tuesday',
        'validUntil': until.toIso8601String(),
      });
    });

    test('withdraw and accept and restore', () async {
      final hits = <_Hit>[];
      final repo = _repo((req) {
        if (req.url.path.endsWith('/withdraw')) {
          return _json(_quote(status: 'withdrawn'));
        }
        if (req.url.path.endsWith('/accept')) {
          return _json({'quotation': _quote(status: 'accepted'), 'booking': _booking()},
              201);
        }
        if (req.url.path.endsWith('/restore-not-selected')) {
          return _json(_list([_quote(status: 'submitted')]));
        }
        return _json(_quote());
      }, hits);

      final withdrawn = await repo.withdraw(_quoteId);
      expect(withdrawn.status.name, 'withdrawn');
      expect(hits[0].request.method, 'POST');
      expect(hits[0].request.headers['idempotency-key'], isNotNull);
      expect(hits[0].request.body, isEmpty);

      final accepted = await repo.accept(_quoteId, notes: 'Go ahead');
      expect(accepted.quotation.status.name, 'accepted');
      expect(accepted.booking.status.name, 'pendingPaymentArrangement');
      expect(accepted.booking.agreedAmount.amountMinor, 95000);
      expect(accepted.booking.commissionRateBps, 500);
      expect(jsonDecode(hits[1].request.body), {'notes': 'Go ahead'});

      final restored = await repo.restoreNotSelected(_loadId, reason: 'retry');
      expect(restored, hasLength(1));
      expect(hits[2].request.url.path,
          '/loads/$_loadId/quotations/restore-not-selected');
      expect(jsonDecode(hits[2].request.body), {'reason': 'retry'});
    });

    test('payout preview is side-effect free and keeps the spec example',
        () async {
      final hits = <_Hit>[];
      final repo = _repo((_) => _json(_preview()), hits);
      final preview = await repo.previewPayout(const PayoutPreviewRequest(
        transporterCompanyId: _companyId,
        loadId: _loadId,
        amount: MoneyAmount(amountMinor: 100000, currency: 'USD'),
        paymentMethod: 'prepay',
      ));
      expect(preview.netPayoutBeforeUnknownFees.amountMinor, 95000);
      expect(preview.commissionAmount.amountMinor, 5000);
      expect(preview.feeStatus, 'unknown');
      expect(preview.paymentProtectedPossible, isTrue);
      expect(preview.submissionBlockers, isEmpty);
      final req = hits.single.request;
      expect(req.url.path, '/quotations/payout-preview');
      expect(req.headers.containsKey('idempotency-key'), isFalse);
      expect(jsonDecode(req.body), {
        'transporterCompanyId': _companyId,
        'amount': {'amountMinor': 100000, 'currency': 'USD'},
        'loadId': _loadId,
        'paymentMethod': 'prepay',
      });
    });

    test('preview blockers parse without keeping outstanding amounts', () async {
      final repo = _repo(
        (_) => _json(_preview(
          agreed: 25010,
          commission: 1251,
          net: 23759,
          paymentMethod: 'escrow',
          blockers: [
            {
              'code': 'ACCOUNT_BANNED',
              'details': {'bannedUntil': '2026-11-24T09:00:00Z'},
            },
            {
              'code': 'COMMISSION_OUTSTANDING',
              'details': {
                'outstandingAmount': {'amountMinor': 1500, 'currency': 'USD'},
                'outstandingByCurrency': [
                  {'amountMinor': 1500, 'currency': 'USD'},
                ],
              },
            },
          ],
        )),
        [],
      );
      final preview = await repo.previewPayout(const PayoutPreviewRequest(
        transporterCompanyId: _companyId,
        amount: MoneyAmount(amountMinor: 25010, currency: 'USD'),
      ));
      expect(preview.submissionBlockers.map((b) => b.code), [
        'ACCOUNT_BANNED',
        'COMMISSION_OUTSTANDING',
      ]);
      expect(preview.submissionBlockers.first.bannedUntil,
          DateTime.utc(2026, 11, 24, 9));
      expect(preview.netPayoutBeforeUnknownFees.amountMinor, 23759);
    });
  });

  group('documented errors', () {
    final banCopy = TruberCopy.banBlockedActionToastFor(
        formatDisplayDate(DateTime.parse('2026-11-24T09:00:00Z').toLocal()));

    Future<void> check({
      required int status,
      required Map<String, dynamic> body,
      required String copy,
      required String method,
      required String path,
      required Future<Object?> Function(LiveQuotationRepository repo) call,
    }) async {
      final hits = <_Hit>[];
      final repo = _repo((_) => _json(body, status), hits);
      final e = await _capture(call(repo));
      expect(e.statusCode, status, reason: body['code']);
      expect(e.code, body['code']);
      expect(mapErrorMessage(e), copy, reason: body['code']);
      expect(mapErrorMessage(e).contains('1500'), isFalse);
      expect(mapErrorMessage(e).contains(body['message'] as String), isFalse);
      final first = hits.first.request;
      expect(first.method, method, reason: body['code']);
      expect(first.url.path, path, reason: body['code']);
      // A 401 triggers one refresh attempt. Other statuses are a single call.
      if (status == 401) {
        expect(hits.last.request.url.path, '/auth/refresh');
      } else {
        expect(hits, hasLength(1), reason: body['code']);
      }
    }

    Future<Quotation> create(LiveQuotationRepository repo) => repo.submit(
          _loadId,
          CreateQuotationRequest(
            transporterCompanyId: _companyId,
            amount: const MoneyAmount(amountMinor: 1, currency: 'USD'),
            validUntil: DateTime.utc(2026, 12, 1),
          ),
        );
    const createPath = '/loads/$_loadId/quotations';

    test('create: ban gate', () async {
      await check(
        status: 409,
        body: _banned(),
        copy: banCopy,
        method: 'POST',
        path: createPath,
        call: create,
      );
      await check(
        status: 409,
        body: _banned(party: 'counterparty_company'),
        copy: TruberCopy.banCounterpartyBlocked,
        method: 'POST',
        path: createPath,
        call: create,
      );
    });

    test('create: commission gate, one and two currencies', () async {
      for (final two in [false, true]) {
        await check(
          status: 409,
          body: _commission(twoCurrencies: two),
          copy: TruberCopy.errorValidation,
          method: 'POST',
          path: createPath,
          call: create,
        );
      }
    });

    test('create: validation, currency, auth, forbidden, not found, duplicate',
        () async {
      final cases = [
        (
          400,
          _error('VALIDATION_ERROR', 'Request validation failed'),
          TruberCopy.errorValidation
        ),
        (
          400,
          _error('CURRENCY_MISMATCH',
              'Quotation currency must match the load currency.'),
          TruberCopy.errorValidation
        ),
        (401, _error('UNAUTHORIZED', 'Sign in again.'), TruberCopy.errorUnauthorized),
        (
          403,
          _error('COMPANY_TYPE_MISMATCH',
              'Quotations can only be submitted by a transporter company.'),
          TruberCopy.errorForbidden
        ),
        (
          403,
          _error('ROLE_NOT_PERMITTED', 'Only a transporter can submit a quotation.'),
          TruberCopy.errorForbidden
        ),
        (404, _error('NOT_FOUND', 'Load not found.'), TruberCopy.errorNotFound),
        (
          409,
          _error('QUOTATION_ALREADY_OPEN',
              'An open quotation already exists for this company on this load.'),
          TruberCopy.errorValidation
        ),
        (
          409,
          _error('LOAD_NOT_OPEN_FOR_QUOTES', 'This load is not open for quotations.'),
          TruberCopy.errorValidation
        ),
      ];
      for (final c in cases) {
        await check(
          status: c.$1,
          body: c.$2,
          copy: c.$3,
          method: 'POST',
          path: createPath,
          call: create,
        );
      }
    });

    test('withdraw: self-cancel, not withdrawable, auth', () async {
      const path = '/quotations/$_quoteId/withdraw';
      Future<Quotation> call(LiveQuotationRepository repo) =>
          repo.withdraw(_quoteId);
      await check(
        status: 409,
        body: _error(
          'SELF_CANCEL_NOT_ALLOWED',
          'This booking can only be cancelled by Truber admin. Contact support.',
          {
            'bookingId': _bookingId,
            'bookingStatus': 'pending_payment_arrangement',
          },
        ),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _error('QUOTATION_NOT_WITHDRAWABLE',
            'This quotation can no longer be withdrawn.'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 403,
        body: _error('ROLE_NOT_PERMITTED',
            'Only the transporter can withdraw a quotation.'),
        copy: TruberCopy.errorForbidden,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 404,
        body: _error('NOT_FOUND', 'Quotation not found.'),
        copy: TruberCopy.errorNotFound,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 401,
        body: _error('UNAUTHORIZED', 'Sign in again.'),
        copy: TruberCopy.errorUnauthorized,
        method: 'POST',
        path: path,
        call: call,
      );
    });

    test('accept: ban, commission, validation, auth', () async {
      const path = '/quotations/$_quoteId/accept';
      Future<Object?> call(LiveQuotationRepository repo) =>
          repo.accept(_quoteId, notes: 'n');
      await check(
        status: 409,
        body: _banned(party: 'counterparty_company'),
        copy: TruberCopy.banCounterpartyBlocked,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _banned(),
        copy: banCopy,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _commission(),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _error('QUOTATION_NOT_ACCEPTABLE',
            'This quotation is not open for acceptance.'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _error('QUOTATION_EXPIRED', 'This quotation has expired.'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 409,
        body: _error('BOOKING_ALREADY_EXISTS',
            'An active booking already exists for this load.'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 400,
        body: _error('VALIDATION_ERROR', 'Request validation failed'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 401,
        body: _error('UNAUTHORIZED', 'Sign in again.'),
        copy: TruberCopy.errorUnauthorized,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 403,
        body: _error('ROLE_NOT_PERMITTED',
            'Only the shipper who owns the load can accept a quotation.'),
        copy: TruberCopy.errorForbidden,
        method: 'POST',
        path: path,
        call: call,
      );
      await check(
        status: 404,
        body: _error('NOT_FOUND', 'Quotation not found.'),
        copy: TruberCopy.errorNotFound,
        method: 'POST',
        path: path,
        call: call,
      );
    });

    test('payout preview: validation, currency, auth, forbidden, not found',
        () async {
      const path = '/quotations/payout-preview';
      Future<PayoutPreview> call(LiveQuotationRepository repo) =>
          repo.previewPayout(
            const PayoutPreviewRequest(
              transporterCompanyId: _companyId,
              loadId: _loadId,
              amount: MoneyAmount(amountMinor: 100, currency: 'ZWG'),
            ),
          );
      final cases = [
        (
          400,
          _error('VALIDATION_ERROR', 'Request validation failed'),
          TruberCopy.errorValidation
        ),
        (
          400,
          _error('CURRENCY_MISMATCH',
              'Quotation currency must match the load currency.'),
          TruberCopy.errorValidation
        ),
        (401, _error('UNAUTHORIZED', 'Sign in again.'), TruberCopy.errorUnauthorized),
        (
          403,
          _error('COMPANY_TYPE_MISMATCH', 'Not a transporter company.'),
          TruberCopy.errorForbidden
        ),
        (
          403,
          _error('ROLE_NOT_PERMITTED', 'Only a transporter can preview a payout.'),
          TruberCopy.errorForbidden
        ),
        (404, _error('NOT_FOUND', 'Company not found.'), TruberCopy.errorNotFound),
      ];
      for (final c in cases) {
        await check(
          status: c.$1,
          body: c.$2,
          copy: c.$3,
          method: 'POST',
          path: path,
          call: call,
        );
      }
    });

    test('list, get, and restore: auth errors', () async {
      await check(
        status: 401,
        body: _error('UNAUTHORIZED', 'Sign in again.'),
        copy: TruberCopy.errorUnauthorized,
        method: 'GET',
        path: '/loads/$_loadId/quotations',
        call: (repo) => repo.forLoad(_loadId),
      );
      await check(
        status: 403,
        body: _error('FORBIDDEN', 'You cannot view these quotations.'),
        copy: TruberCopy.errorForbidden,
        method: 'GET',
        path: '/loads/$_loadId/quotations',
        call: (repo) => repo.forLoad(_loadId),
      );
      await check(
        status: 404,
        body: _error('NOT_FOUND', 'Load not found.'),
        copy: TruberCopy.errorNotFound,
        method: 'GET',
        path: '/quotations/$_quoteId',
        call: (repo) => repo.getById(_quoteId),
      );
      await check(
        status: 409,
        body: _error('CONFLICT', 'These quotations cannot be restored.'),
        copy: TruberCopy.errorValidation,
        method: 'POST',
        path: '/loads/$_loadId/quotations/restore-not-selected',
        call: (repo) => repo.restoreNotSelected(_loadId),
      );
      await check(
        status: 403,
        body: _error('FORBIDDEN', 'You cannot restore these quotations.'),
        copy: TruberCopy.errorForbidden,
        method: 'POST',
        path: '/loads/$_loadId/quotations/restore-not-selected',
        call: (repo) => repo.restoreNotSelected(_loadId),
      );
      await check(
        status: 404,
        body: _error('NOT_FOUND', 'Load not found.'),
        copy: TruberCopy.errorNotFound,
        method: 'POST',
        path: '/loads/$_loadId/quotations/restore-not-selected',
        call: (repo) => repo.restoreNotSelected(_loadId),
      );
    });
  });
}

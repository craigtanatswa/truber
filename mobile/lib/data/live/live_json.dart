import '../../models/booking.dart';
import '../../models/company.dart';
import '../../models/load.dart';
import '../../models/money.dart';
import '../../models/quotation.dart';
import '../../models/user.dart';

/// JSON <-> model mapping for OpenAPI v0.4.0 schemas. Unknown enum values map
/// to the most conservative app value instead of throwing.

String _camel(String snake) => snake.replaceAllMapped(
    RegExp(r'_([a-z])'), (m) => m.group(1)!.toUpperCase());

String _snake(String camel) =>
    camel.replaceAllMapped(RegExp(r'[A-Z]'), (m) => '_${m[0]!.toLowerCase()}');

T _enum<T extends Enum>(List<T> values, Object? raw, T fallback) {
  if (raw is! String) return fallback;
  final key = _camel(raw);
  for (final v in values) {
    if (v.name == key) return v;
  }
  return fallback;
}

DateTime _dt(Object? v) => DateTime.parse(v as String);
DateTime? _dtOrNull(Object? v) => v is String ? DateTime.parse(v) : null;

String _date(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

UserRole userRoleFromJson(Object? v) =>
    _enum(UserRole.values, v, UserRole.shipper);

TruberUser userFromJson(Map<String, dynamic> j) => TruberUser(
      id: j['id'] as String,
      email: j['email'] as String,
      fullName: j['fullName'] as String,
      phone: j['phone'] as String?,
      role: userRoleFromJson(j['role']),
      accountStatus: _enum(AccountStatus.values, j['accountStatus'],
          AccountStatus.pendingVerification),
      createdAt: _dt(j['createdAt']),
      updatedAt: _dt(j['updatedAt']),
      bannedUntil: _dtOrNull(j['bannedUntil']),
    );

AuthTokenResponse tokensFromJson(Map<String, dynamic> j) => AuthTokenResponse(
      accessToken: j['accessToken'] as String,
      refreshToken: j['refreshToken'] as String,
      tokenType: (j['tokenType'] as String?) ?? 'Bearer',
      expiresIn: (j['expiresIn'] as num).toInt(),
      user: userFromJson(j['user'] as Map<String, dynamic>),
    );

Company companyFromJson(Map<String, dynamic> j) => Company(
      id: j['id'] as String,
      type: _enum(CompanyType.values, j['type'], CompanyType.shipper),
      legalName: j['legalName'] as String,
      tradingName: j['tradingName'] as String?,
      registrationNumber: j['registrationNumber'] as String?,
      taxNumber: j['taxNumber'] as String?,
      countryCode: (j['countryCode'] as String?) ?? 'ZW',
      city: j['city'] as String?,
      verificationStatus: _enum(VerificationStatus.values,
          j['verificationStatus'], VerificationStatus.unverified),
      createdAt: _dt(j['createdAt']),
      updatedAt: _dt(j['updatedAt']),
      bannedUntil: _dtOrNull(j['bannedUntil']),
    );

MoneyAmount? _money(Object? v) => v is Map<String, dynamic>
    ? MoneyAmount(
        amountMinor: (v['amountMinor'] as num).toInt(),
        currency: v['currency'] as String,
      )
    : null;

FreightLoad loadFromJson(Map<String, dynamic> j) => FreightLoad(
      id: j['id'] as String,
      companyId: j['companyId'] as String,
      status: _enum(LoadStatus.values, j['status'], LoadStatus.draft),
      goodsType: j['goodsType'] as String,
      weightKg: (j['weightKg'] as num).toInt(),
      truckTypeRequired: TruckTypeLabel.parse(j['truckTypeRequired'] as String),
      pickupAddress: j['pickupAddress'] as String,
      destinationAddress: j['destinationAddress'] as String,
      loadingDate: _dt(j['loadingDate']),
      deliveryDeadline: _dtOrNull(j['deliveryDeadline']),
      specialRequirements: j['specialRequirements'] as String?,
      rateType: _enum(RateType.values, j['rateType'], RateType.negotiable),
      offeredRate: _money(j['offeredRate']),
      currency: j['currency'] as String,
      createdAt: _dt(j['createdAt']),
      updatedAt: _dt(j['updatedAt']),
    );

Map<String, dynamic> createLoadToJson(CreateLoadRequest r) => {
      'companyId': r.companyId,
      'goodsType': r.goodsType,
      'weightKg': r.weightKg,
      'truckTypeRequired': r.truckTypeRequired.apiValue,
      'pickupAddress': r.pickupAddress,
      'destinationAddress': r.destinationAddress,
      'loadingDate': _date(r.loadingDate),
      if (r.deliveryDeadline != null)
        'deliveryDeadline': _date(r.deliveryDeadline!),
      if (r.specialRequirements != null && r.specialRequirements!.isNotEmpty)
        'specialRequirements': r.specialRequirements,
      'rateType': r.rateType.name,
      if (r.offeredRate != null)
        'offeredRate': {
          'amountMinor': r.offeredRate!.amountMinor,
          'currency': r.offeredRate!.currency,
        },
      'currency': r.currency,
    };

String apiEnum(Enum e) => _snake(e.name);
String apiDate(DateTime d) => _date(d);

String apiDateTime(DateTime d) => d.toUtc().toIso8601String();

Quotation quotationFromJson(Map<String, dynamic> j) => Quotation(
      id: j['id'] as String,
      loadId: j['loadId'] as String,
      transporterCompanyId: j['transporterCompanyId'] as String,
      truckId: j['truckId'] as String?,
      amount: _money(j['amount'])!,
      status: _enum(
          QuotationStatus.values, j['status'], QuotationStatus.submitted),
      notes: j['notes'] as String?,
      validUntil: _dt(j['validUntil']),
      createdAt: _dt(j['createdAt']),
      updatedAt: _dt(j['updatedAt']),
      counterpartyRestrictedUntil: _dtOrNull(j['counterpartyRestrictedUntil']),
    );

Booking bookingFromJson(Map<String, dynamic> j) => Booking(
      id: j['id'] as String,
      loadId: j['loadId'] as String,
      quotationId: j['quotationId'] as String,
      shipperCompanyId: j['shipperCompanyId'] as String,
      transporterCompanyId: j['transporterCompanyId'] as String,
      truckId: j['truckId'] as String?,
      status: _enum(BookingStatus.values, j['status'],
          BookingStatus.pendingPaymentArrangement),
      tripStatus:
          _enum(TripStatus.values, j['tripStatus'], TripStatus.notStarted),
      completionStatus: _enum(CompletionStatus.values, j['completionStatus'],
          CompletionStatus.notComplete),
      agreedAmount: _money(j['agreedAmount'])!,
      commissionRateBps: (j['commissionRateBps'] as num).toInt(),
      confirmedPaymentArrangementId:
          j['confirmedPaymentArrangementId'] as String?,
      confirmedAt: _dtOrNull(j['confirmedAt']),
      createdAt: _dt(j['createdAt']),
      updatedAt: _dt(j['updatedAt']),
    );

AcceptQuotationResponse acceptQuotationFromJson(Map<String, dynamic> j) =>
    AcceptQuotationResponse(
      quotation: quotationFromJson(j['quotation'] as Map<String, dynamic>),
      booking: bookingFromJson(j['booking'] as Map<String, dynamic>),
    );

List<Quotation> quotationListFromJson(Map<String, dynamic> j) =>
    (j['data'] as List)
        .map((e) => quotationFromJson(e as Map<String, dynamic>))
        .toList();

PayoutPreview payoutPreviewFromJson(Map<String, dynamic> j) {
  final blockers = <SubmissionBlocker>[];
  final raw = j['submissionBlockers'];
  if (raw is List) {
    for (final item in raw) {
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final details = map['details'];
      DateTime? until;
      if (details is Map && details['bannedUntil'] is String) {
        until = DateTime.tryParse(details['bannedUntil'] as String);
      }
      // Outstanding amounts stay in the JSON only. They are not copied onto
      // the model, so a widget cannot render a commission breakdown from them.
      blockers.add(SubmissionBlocker(
        code: map['code'] as String? ?? '',
        bannedUntil: until,
      ));
    }
  }
  return PayoutPreview(
    agreedAmount: _money(j['agreedAmount'])!,
    commissionRateBps: (j['commissionRateBps'] as num).toInt(),
    commissionAmount: _money(j['commissionAmount'])!,
    knownFeesTotal: _money(j['knownFeesTotal'])!,
    netPayoutBeforeUnknownFees: _money(j['netPayoutBeforeUnknownFees'])!,
    feeStatus: j['feeStatus'] as String,
    paymentMethod: j['paymentMethod'] as String?,
    farePayoutDueThroughTruber: j['farePayoutDueThroughTruber'] as bool,
    paymentProtectedPossible: j['paymentProtectedPossible'] as bool,
    submissionBlockers: blockers,
  );
}

Map<String, dynamic> createQuotationToJson(CreateQuotationRequest r) => {
      'transporterCompanyId': r.transporterCompanyId,
      if (r.truckId != null) 'truckId': r.truckId,
      'amount': r.amount.toJson(),
      if (r.notes != null && r.notes!.isNotEmpty) 'notes': r.notes,
      'validUntil': apiDateTime(r.validUntil),
    };

Map<String, dynamic> payoutPreviewToJson(PayoutPreviewRequest r) => {
      'transporterCompanyId': r.transporterCompanyId,
      'amount': r.amount.toJson(),
      if (r.loadId != null) 'loadId': r.loadId,
      if (r.paymentMethod != null) 'paymentMethod': r.paymentMethod,
    };

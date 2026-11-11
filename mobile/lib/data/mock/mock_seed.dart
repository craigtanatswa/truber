import '../../models/company.dart';
import '../../models/load.dart';
import '../../models/money.dart';
import '../../models/quotation.dart';
import '../../models/user.dart';

/// Fixed UUIDs for deterministic mocks (OpenAPI Uuid format).
abstract final class MockIds {
  static const shipperUser = '11111111-1111-4111-8111-111111111111';
  static const transporterUser = '22222222-2222-4222-8222-222222222222';
  static const adminUser = '33333333-3333-4333-8333-333333333333';
  static const shipperCompany = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  static const transporterCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  static const load1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  static const load2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  static const load3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  static const quote1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  static const quote2 = 'ffffffff-ffff-4fff-8fff-fffffffffffe';
  static const quote3 = 'ffffffff-ffff-4fff-8fff-fffffffffffd';
  static const bannedShipperUser = '11111111-1111-4111-8111-111111111112';
  static const bannedCompanyMember = '22222222-2222-4222-8222-222222222223';
  static const bannedShipperCompany = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  static const bannedTransporterCompany =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
  static const bannedTransporterUser = '22222222-2222-4222-8222-222222222224';
  static const hwangeTransporterCompany =
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd';
}

DateTime get _now => DateTime.utc(2026, 11, 6, 12);

/// Spec-shaped OffPlatformBan.endsAt example (startsAt + 14 days).
final DateTime seedBanEndsAt = DateTime.utc(2026, 11, 24, 8);

List<TruberUser> seedUsers() => [
      TruberUser(
        id: MockIds.shipperUser,
        email: 'shipper@truber.zw',
        fullName: 'Tendai Moyo',
        phone: '0772111222',
        role: UserRole.shipper,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
      ),
      TruberUser(
        id: MockIds.transporterUser,
        email: 'transporter@truber.zw',
        fullName: 'Chipo Ncube',
        phone: '0773333444',
        role: UserRole.transporter,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
      ),
      // Responsible user of a confirmed finding: User.bannedUntil set
      // (and the company ban below).
      TruberUser(
        id: MockIds.bannedShipperUser,
        email: 'banned.shipper@truber.zw',
        fullName: 'Rufaro Chiedza',
        phone: '0772999000',
        role: UserRole.shipper,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
        bannedUntil: seedBanEndsAt,
      ),
      // Member of a banned company who is not personally banned.
      TruberUser(
        id: MockIds.bannedCompanyMember,
        email: 'kariba@truber.zw',
        fullName: 'Tatenda Mlambo',
        phone: '0773999000',
        role: UserRole.transporter,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
      ),
      // User-level ban only (User.bannedUntil); company not banned.
      TruberUser(
        id: MockIds.bannedTransporterUser,
        email: 'banned.transporter@truber.zw',
        fullName: 'Farai Sibanda',
        phone: '0773888000',
        role: UserRole.transporter,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
        bannedUntil: seedBanEndsAt,
      ),
      TruberUser(
        id: MockIds.adminUser,
        email: 'admin@truber.zw',
        fullName: 'Ops Admin',
        phone: '0774555666',
        role: UserRole.admin,
        accountStatus: AccountStatus.active,
        createdAt: _now,
        updatedAt: _now,
      ),
    ];

List<Company> seedCompanies() => [
      Company(
        id: MockIds.shipperCompany,
        type: CompanyType.shipper,
        legalName: 'Moyo Agri Co',
        verificationStatus: VerificationStatus.verified,
        createdAt: _now,
        updatedAt: _now,
        city: 'Harare',
      ),
      Company(
        id: MockIds.transporterCompany,
        type: CompanyType.transporter,
        legalName: 'Ncube Haulage',
        verificationStatus: VerificationStatus.verified,
        createdAt: _now,
        updatedAt: _now,
        city: 'Bulawayo',
      ),
      Company(
        id: MockIds.bannedShipperCompany,
        type: CompanyType.shipper,
        legalName: 'Chiedza Foods',
        verificationStatus: VerificationStatus.verified,
        createdAt: _now,
        updatedAt: _now,
        city: 'Harare',
        bannedUntil: seedBanEndsAt,
      ),
      Company(
        id: MockIds.bannedTransporterCompany,
        type: CompanyType.transporter,
        legalName: 'Kariba Freight',
        verificationStatus: VerificationStatus.verified,
        createdAt: _now,
        updatedAt: _now,
        city: 'Kariba',
        bannedUntil: seedBanEndsAt,
      ),
      Company(
        id: MockIds.hwangeTransporterCompany,
        type: CompanyType.transporter,
        legalName: 'Hwange Haulage',
        verificationStatus: VerificationStatus.verified,
        createdAt: _now,
        updatedAt: _now,
        city: 'Hwange',
      ),
    ];

/// userId → companyId (MVP: one company per user in mock).
Map<String, String> seedUserCompanies() => {
      MockIds.shipperUser: MockIds.shipperCompany,
      MockIds.transporterUser: MockIds.transporterCompany,
      MockIds.bannedShipperUser: MockIds.bannedShipperCompany,
      MockIds.bannedCompanyMember: MockIds.bannedTransporterCompany,
      MockIds.bannedTransporterUser: MockIds.hwangeTransporterCompany,
    };

List<FreightLoad> seedLoads() => [
      FreightLoad(
        id: MockIds.load1,
        companyId: MockIds.shipperCompany,
        status: LoadStatus.posted,
        goodsType: 'Fertiliser',
        weightKg: 28000,
        truckTypeRequired: TruckType.flatbed,
        pickupAddress: 'Harare',
        destinationAddress: 'Bulawayo',
        loadingDate: DateTime.utc(2026, 11, 8),
        deliveryDeadline: DateTime.utc(2026, 11, 11),
        rateType: RateType.negotiable,
        offeredRate: const MoneyAmount(amountMinor: 100000, currency: 'USD'),
        currency: 'USD',
        createdAt: _now,
        updatedAt: _now,
      ),
      FreightLoad(
        id: MockIds.load2,
        companyId: MockIds.shipperCompany,
        status: LoadStatus.quoting,
        goodsType: 'Timber',
        weightKg: 18000,
        truckTypeRequired: TruckType.box,
        pickupAddress: 'Mutare',
        destinationAddress: 'Harare',
        loadingDate: DateTime.utc(2026, 11, 9),
        deliveryDeadline: DateTime.utc(2026, 11, 12),
        rateType: RateType.fixed,
        offeredRate: const MoneyAmount(amountMinor: 65000, currency: 'USD'),
        currency: 'USD',
        createdAt: _now,
        updatedAt: _now,
      ),
      FreightLoad(
        id: MockIds.load3,
        companyId: MockIds.shipperCompany,
        status: LoadStatus.posted,
        goodsType: 'Maize',
        weightKg: 32000,
        truckTypeRequired: TruckType.tipper,
        pickupAddress: 'Gweru',
        destinationAddress: 'Masvingo',
        loadingDate: DateTime.utc(2026, 11, 7),
        deliveryDeadline: DateTime.utc(2026, 11, 10),
        rateType: RateType.negotiable,
        offeredRate: const MoneyAmount(amountMinor: 48000, currency: 'USD'),
        currency: 'USD',
        createdAt: _now,
        updatedAt: _now,
      ),
    ];

List<Quotation> seedQuotations() => [
      Quotation(
        id: MockIds.quote1,
        loadId: MockIds.load1,
        transporterCompanyId: MockIds.transporterCompany,
        amount: const MoneyAmount(amountMinor: 95000, currency: 'USD'),
        status: QuotationStatus.submitted,
        notes: 'Can load Tuesday morning.',
        validUntil: DateTime.utc(2026, 11, 10),
        createdAt: _now,
        updatedAt: _now,
        transporterLegalName: 'Ncube Haulage',
      ),
      Quotation(
        id: MockIds.quote2,
        loadId: MockIds.load1,
        transporterCompanyId: MockIds.transporterCompany,
        amount: const MoneyAmount(amountMinor: 98000, currency: 'USD'),
        status: QuotationStatus.submitted,
        notes: 'Alternate rate.',
        validUntil: DateTime.utc(2026, 11, 10),
        createdAt: _now,
        updatedAt: _now,
        transporterLegalName: 'Ncube Haulage',
      ),
      // From a banned company: shipper sees ban.counterparty_blocked.
      Quotation(
        id: MockIds.quote3,
        loadId: MockIds.load1,
        transporterCompanyId: MockIds.bannedTransporterCompany,
        amount: const MoneyAmount(amountMinor: 90000, currency: 'USD'),
        status: QuotationStatus.submitted,
        notes: 'Truck free from Monday.',
        validUntil: DateTime.utc(2026, 11, 10),
        createdAt: _now,
        updatedAt: _now,
        transporterLegalName: 'Kariba Freight',
      ),
    ];

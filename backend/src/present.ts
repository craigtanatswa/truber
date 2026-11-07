import { QueryResultRow } from 'pg';
import { CompanyResponse, DbUser, GeoPointResponse, LoadResponse, UserResponse } from './domain';
import { iso } from './common/crypto';

export function presentUser(user: DbUser): UserResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    role: user.role,
    accountStatus: user.account_status,
    createdAt: iso(user.created_at),
    updatedAt: iso(user.updated_at),
  };
}

export function presentCompany(row: QueryResultRow): CompanyResponse {
  return {
    id: String(row.id),
    type: row.type as CompanyResponse['type'],
    legalName: String(row.legal_name),
    tradingName: nullableString(row.trading_name),
    registrationNumber: nullableString(row.registration_number),
    taxNumber: nullableString(row.tax_number),
    countryCode: String(row.country_code),
    city: nullableString(row.city),
    verificationStatus: row.verification_status as CompanyResponse['verificationStatus'],
    createdAt: iso(asTimestamp(row.created_at)),
    updatedAt: iso(asTimestamp(row.updated_at)),
  };
}

function presentPoint(value: unknown): GeoPointResponse | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === 'string' ? (JSON.parse(value) as { latitude: unknown; longitude: unknown }) : (value as { latitude: unknown; longitude: unknown });
  return {
    latitude: Number(parsed.latitude),
    longitude: Number(parsed.longitude),
  };
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asTimestamp(value: unknown): Date | string {
  if (value instanceof Date || typeof value === 'string') return value;
  throw new Error('Expected a timestamp value');
}

export function presentLoad(row: QueryResultRow): LoadResponse {
  const offeredAmount = row.offeredAmountMinor;
  const offeredCurrency = row.offeredCurrency;
  return {
    id: String(row.id),
    companyId: String(row.companyId),
    status: row.status as LoadResponse['status'],
    goodsType: String(row.goodsType),
    weightKg: Number(row.weightKg),
    truckTypeRequired: String(row.truckTypeRequired),
    pickupAddress: String(row.pickupAddress),
    pickupPoint: presentPoint(row.pickupPoint),
    destinationAddress: String(row.destinationAddress),
    destinationPoint: presentPoint(row.destinationPoint),
    loadingDate: String(row.loadingDate),
    deliveryDeadline: nullableString(row.deliveryDeadline),
    specialRequirements: nullableString(row.specialRequirements),
    rateType: row.rateType as LoadResponse['rateType'],
    offeredRate:
      offeredAmount == null || offeredCurrency == null
        ? null
        : { amountMinor: Number(offeredAmount), currency: String(offeredCurrency) },
    currency: String(row.currency),
    createdAt: iso(asTimestamp(row.createdAt)),
    updatedAt: iso(asTimestamp(row.updatedAt)),
  };
}

export const LOAD_RETURNING = `
  l.id,
  l.company_id AS "companyId",
  l.status,
  l.goods_type AS "goodsType",
  l.weight_kg AS "weightKg",
  l.truck_type_required AS "truckTypeRequired",
  l.pickup_address AS "pickupAddress",
  CASE WHEN l.pickup_geog IS NULL THEN NULL ELSE json_build_object(
    'latitude', ST_Y(l.pickup_geog::geometry),
    'longitude', ST_X(l.pickup_geog::geometry)
  ) END AS "pickupPoint",
  l.destination_address AS "destinationAddress",
  CASE WHEN l.destination_geog IS NULL THEN NULL ELSE json_build_object(
    'latitude', ST_Y(l.destination_geog::geometry),
    'longitude', ST_X(l.destination_geog::geometry)
  ) END AS "destinationPoint",
  to_char(l.loading_date, 'YYYY-MM-DD') AS "loadingDate",
  to_char(l.delivery_deadline, 'YYYY-MM-DD') AS "deliveryDeadline",
  l.special_requirements AS "specialRequirements",
  l.rate_type AS "rateType",
  l.offered_amount_minor AS "offeredAmountMinor",
  l.offered_currency AS "offeredCurrency",
  l.currency,
  l.created_at AS "createdAt",
  l.updated_at AS "updatedAt"
`;

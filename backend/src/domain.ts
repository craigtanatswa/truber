export type UserRole = 'shipper' | 'transporter' | 'admin';
export type AccountStatus = 'pending_verification' | 'active' | 'suspended' | 'disabled';
export type CompanyType = 'shipper' | 'transporter';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type LoadStatus =
  | 'draft'
  | 'posted'
  | 'quoting'
  | 'booking_pending'
  | 'booked'
  | 'in_progress'
  | 'awaiting_shipper_acceptance'
  | 'completed'
  | 'cancelled';

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  city: string | null;
  role: UserRole;
  account_status: AccountStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokenResponseBody {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserResponse;
}

export interface CompanyResponse {
  id: string;
  type: CompanyType;
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  countryCode: string;
  city: string | null;
  verificationStatus: VerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GeoPointResponse {
  latitude: number;
  longitude: number;
}

export interface MoneyResponse {
  amountMinor: number;
  currency: string;
}

export interface LoadResponse {
  id: string;
  companyId: string;
  status: LoadStatus;
  goodsType: string;
  weightKg: number;
  truckTypeRequired: string;
  pickupAddress: string;
  pickupPoint: GeoPointResponse | null;
  destinationAddress: string;
  destinationPoint: GeoPointResponse | null;
  loadingDate: string;
  deliveryDeadline: string | null;
  specialRequirements: string | null;
  rateType: 'fixed' | 'negotiable';
  offeredRate: MoneyResponse | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export type QuotationStatus = 'submitted' | 'withdrawn' | 'accepted' | 'not_selected' | 'rejected' | 'expired';

export interface QuotationResponse {
  id: string;
  loadId: string;
  transporterCompanyId: string;
  truckId: string | null;
  amount: MoneyResponse;
  status: QuotationStatus;
  notes: string | null;
  validUntil: string;
  createdAt: string;
  updatedAt: string;
}

export type BookingStatus = 'pending_payment_arrangement' | 'confirmed' | 'cancelled';
export type TripStatus = 'not_started' | 'truck_dispatched' | 'goods_collected' | 'in_transit' | 'delivered';
export type CompletionStatus =
  | 'not_complete'
  | 'awaiting_shipper_acceptance'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface BookingResponse {
  id: string;
  loadId: string;
  quotationId: string;
  shipperCompanyId: string;
  transporterCompanyId: string;
  truckId: string | null;
  status: BookingStatus;
  tripStatus: TripStatus;
  completionStatus: CompletionStatus;
  agreedAmount: MoneyResponse;
  commissionRateBps: 500;
  confirmedPaymentArrangementId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptQuotationResponse {
  quotation: QuotationResponse;
  booking: BookingResponse;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const TRUCK_TYPES = ['flatbed', 'box', 'refrigerated', 'tanker', 'tipper', 'side_loader', 'other'] as const;
export const LOAD_STATUSES: LoadStatus[] = [
  'draft',
  'posted',
  'quoting',
  'booking_pending',
  'booked',
  'in_progress',
  'awaiting_shipper_acceptance',
  'completed',
  'cancelled',
];

export const TRANSPORTER_VISIBLE_STATUSES: LoadStatus[] = [
  'posted',
  'quoting',
  'booking_pending',
  'booked',
  'in_progress',
  'awaiting_shipper_acceptance',
  'completed',
];

export const CANCELLABLE_STATUSES: LoadStatus[] = ['draft', 'posted', 'quoting'];

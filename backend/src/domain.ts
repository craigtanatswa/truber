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
  counterpartyRestrictedUntil: string | null;
}

export type BookingStatus = 'pending_payment_arrangement' | 'confirmed' | 'cancelled';
export type TripStatus = 'not_started' | 'truck_dispatched' | 'goods_collected' | 'in_transit' | 'delivered';
export type CompletionStatus =
  | 'not_complete'
  | 'awaiting_shipper_acceptance'
  | 'completed'
  | 'disputed'
  | 'locked'
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
  adjustedAgreedAmount: MoneyResponse | null;
  commissionRateBps: 500;
  deliveryConfirmedAt: string | null;
  disputeWindowEndsAt: string | null;
  lockedAt: string | null;
  confirmedPaymentArrangementId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptQuotationResponse {
  quotation: QuotationResponse;
  booking: BookingResponse;
}

export type DeliveryConfirmationDecision = 'accepted' | 'disputed';

export interface DeliveryConfirmationResponse {
  bookingId: string;
  decision: DeliveryConfirmationDecision;
  notes: string | null;
  confirmedByUserId: string;
  confirmedAt: string;
}

export type DisputeStage = 'at_delivery_confirmation' | 'dispute_window';
export type DisputeStatus = 'awaiting_transporter_response' | 'transporter_responded' | 'settled' | 'resolved';
export type DisputeEvidenceKind = 'photo' | 'signed_pod' | 'message' | 'other';

export interface DisputeEvidenceResponse {
  kind: DisputeEvidenceKind;
  uri: string;
  note?: string;
}

export interface BookingDisputeResponse {
  id: string;
  bookingId: string;
  stage: DisputeStage;
  raisedByUserId: string;
  reason: string;
  evidence: DisputeEvidenceResponse[];
  proposedAmount: MoneyResponse | null;
  status: DisputeStatus;
  openedAt: string;
  responseDueAt: string;
  response: {
    respondedByUserId: string;
    respondedAt: string;
    statement: string;
    evidence: DisputeEvidenceResponse[];
    counterOfferAmount: MoneyResponse | null;
  } | null;
  settlement: {
    amount: MoneyResponse;
    acceptedByUserId: string;
    acceptedAt: string;
    adjustmentId: string | null;
  } | null;
  resolution: {
    outcome: 'complete_trip' | 'adjust_amount' | 'cancel_trip';
    reason: string;
    adjustedAgreedAmount: MoneyResponse | null;
    resolvedAt: string;
  } | null;
  closedAt: string | null;
}

export interface DisputeResolutionResponse {
  bookingId: string;
  resolution: 'complete_trip' | 'adjust_amount' | 'cancel_trip';
  reason: string;
  adjustmentId: string | null;
  disputeId: string | null;
  resolvedByUserId: string;
  resolvedAt: string;
  resultingCompletionStatus: CompletionStatus;
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

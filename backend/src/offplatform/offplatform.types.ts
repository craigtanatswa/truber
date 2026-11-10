import { UserRole } from '../domain';

export type OffPlatformPartyRole = 'shipper' | 'transporter';
export type OffPlatformReportStatus = 'open' | 'confirmed' | 'not_confirmed';
export type OffPlatformOutcome = 'confirmed' | 'not_confirmed';
export type OffPlatformBanStatus = 'active' | 'expired' | 'lifted';
export type OffPlatformSuspectedParty = 'shipper' | 'transporter' | 'both' | 'unknown';

export interface OffPlatformResponsibleParty {
  role: OffPlatformPartyRole;
  userId: string;
  companyId: string;
}

export interface OffPlatformBan {
  id: string;
  findingId: string;
  userId: string;
  companyId: string;
  partyRole: OffPlatformPartyRole;
  status: OffPlatformBanStatus;
  startsAt: string;
  endsAt: string;
  durationDays: 14;
  reason: string;
  appliedByUserId: string;
  liftedAt: string | null;
  liftedByUserId: string | null;
  liftReason: string | null;
}

export interface OffPlatformFinding {
  id: string;
  reportId: string;
  bookingId: string;
  outcome: OffPlatformOutcome;
  reason: string;
  responsibleParties?: OffPlatformResponsibleParty[];
  reviewedByUserId: string;
  reviewedAt: string;
  bans: OffPlatformBan[];
}

export interface OffPlatformReport {
  id: string;
  bookingId: string;
  reportedByUserId: string;
  reporterRole?: UserRole;
  suspectedParty: OffPlatformSuspectedParty;
  description: string;
  evidenceUris?: string[];
  status: OffPlatformReportStatus;
  finding?: OffPlatformFinding | null;
  createdAt: string;
}

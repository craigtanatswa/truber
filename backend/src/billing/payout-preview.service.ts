import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { DbService } from '../db/db.service';
import { DbUser } from '../domain';
import { OffPlatformBanService } from '../offplatform/offplatform-ban.service';
import { LoadsService } from '../loads/loads.service';
import {
  COMMISSION_RATE_BPS,
  computeNetPayout,
  PaymentMethod,
} from './commission';
import {
  CommissionOutstandingDetails,
  commissionOutstandingDetails,
} from './commission-gate.service';
import { Money } from './money';
import { PayoutPreviewDto } from './payout-preview.dto';
import { ReceivablesService } from './receivables.service';

export type FeeStatus = 'unknown' | 'known' | 'not_applicable';

export interface UnknownFee {
  feeType: 'processing_fee';
  reason: 'provider_not_contracted' | 'payment_rail_not_selected';
}

export type PayoutPreviewBlocker =
  | { code: 'ACCOUNT_BANNED'; details: { bannedUntil: string } }
  | { code: 'COMMISSION_OUTSTANDING'; details: CommissionOutstandingDetails };

export interface PayoutPreview {
  agreedAmount: Money;
  commissionRateBps: number;
  commissionAmount: Money;
  knownFees: never[];
  knownFeesTotal: Money;
  netPayoutBeforeUnknownFees: Money;
  feeStatus: FeeStatus;
  unknownFees: UnknownFee[];
  paymentMethod: PaymentMethod | null;
  farePayoutDueThroughTruber: boolean;
  paymentProtectedPossible: boolean;
  submissionBlockers: PayoutPreviewBlocker[];
}

interface FeePlan {
  feeStatus: FeeStatus;
  unknownFees: UnknownFee[];
  farePayoutDueThroughTruber: boolean;
  paymentProtectedPossible: boolean;
}

const PROVIDER_NOT_CONTRACTED: UnknownFee = {
  feeType: 'processing_fee',
  reason: 'provider_not_contracted',
};

const RAIL_NOT_SELECTED: UnknownFee = {
  feeType: 'processing_fee',
  reason: 'payment_rail_not_selected',
};

function feePlan(paymentMethod: PaymentMethod | null): FeePlan {
  if (paymentMethod == null) {
    return {
      feeStatus: 'unknown',
      unknownFees: [RAIL_NOT_SELECTED],
      farePayoutDueThroughTruber: false,
      paymentProtectedPossible: false,
    };
  }
  if (paymentMethod === 'cash') {
    return {
      feeStatus: 'not_applicable',
      unknownFees: [],
      farePayoutDueThroughTruber: false,
      paymentProtectedPossible: false,
    };
  }
  return {
    feeStatus: 'unknown',
    unknownFees: [PROVIDER_NOT_CONTRACTED],
    farePayoutDueThroughTruber: true,
    paymentProtectedPossible: true,
  };
}

@Injectable()
export class PayoutPreviewService {
  constructor(
    private readonly db: DbService,
    private readonly receivables: ReceivablesService,
    private readonly bans: OffPlatformBanService,
    private readonly loads: LoadsService,
  ) {}

  /**
   * Informational, read-only preview. No advisory lock and no transaction: the contract
   * says submissionBlockers are informational only; createQuotation re-checks both gates
   * under the shared lock.
   */
  async preview(actor: DbUser, dto: PayoutPreviewDto): Promise<PayoutPreview> {
    if (actor.role !== 'transporter' && actor.role !== 'admin') {
      throw new ApiException(
        403,
        'ROLE_NOT_PERMITTED',
        'Only a transporter can preview a quotation payout.',
      );
    }

    const company = await this.db.query<{ id: string; type: string }>(
      'SELECT id, type FROM companies WHERE id = $1',
      [dto.transporterCompanyId],
    );
    if (!company.rows[0]) {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      const member = await this.db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [dto.transporterCompanyId, actor.id],
      );
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }
    if (company.rows[0].type !== 'transporter') {
      throw new ApiException(
        403,
        'COMPANY_TYPE_MISMATCH',
        'Quotation payouts can only be previewed for a transporter company.',
      );
    }

    if (dto.loadId !== undefined) {
      const load = await this.loads.get(actor, dto.loadId);
      if (load.currency !== dto.amount.currency) {
        throw new ApiException(
          400,
          'CURRENCY_MISMATCH',
          'Quote currency must match the load currency.',
        );
      }
    }

    const amount: Money = {
      amountMinor: dto.amount.amountMinor,
      currency: dto.amount.currency,
    };
    const netPayout = computeNetPayout({ trip: amount, recordedFees: [] });
    const fees = feePlan(dto.paymentMethod ?? null);

    return {
      agreedAmount: amount,
      commissionRateBps: COMMISSION_RATE_BPS,
      commissionAmount: netPayout.commission,
      knownFees: [],
      knownFeesTotal: { amountMinor: 0, currency: amount.currency },
      netPayoutBeforeUnknownFees: netPayout.net,
      feeStatus: fees.feeStatus,
      unknownFees: fees.unknownFees,
      paymentMethod: dto.paymentMethod ?? null,
      farePayoutDueThroughTruber: fees.farePayoutDueThroughTruber,
      paymentProtectedPossible: fees.paymentProtectedPossible,
      submissionBlockers: await this.blockers(actor, dto.transporterCompanyId),
    };
  }

  private async blockers(actor: DbUser, transporterCompanyId: string): Promise<PayoutPreviewBlocker[]> {
    const submissionBlockers: PayoutPreviewBlocker[] = [];
    try {
      await this.bans.assertNotBanned(actor.id, transporterCompanyId);
    } catch (error) {
      if (error instanceof ApiException && error.code === 'ACCOUNT_BANNED') {
        submissionBlockers.push({
          code: 'ACCOUNT_BANNED',
          details: { bannedUntil: error.details?.bannedUntil as string },
        });
      } else {
        throw error;
      }
    }

    const outstanding = await this.receivables.outstandingByCurrency(null, transporterCompanyId);
    if (outstanding.length > 0) {
      submissionBlockers.push({
        code: 'COMMISSION_OUTSTANDING',
        details: commissionOutstandingDetails(outstanding),
      });
    }
    return submissionBlockers;
  }
}

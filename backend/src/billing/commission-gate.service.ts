import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { Money } from './money';
import { ReceivablesService } from './receivables.service';

export const COMMISSION_OUTSTANDING_MESSAGE =
  'Outstanding commission must be settled before taking new work.';

@Injectable()
export class CommissionGateService {
  constructor(private readonly receivables: ReceivablesService) {}

  /**
   * Blocks new work while any currency still has outstanding commission.
   * Callers (quotation/booking handlers owned by Mark/Brian) must call the
   * ACCOUNT_BANNED guard first, then this.
   */
  async assertCanTakeNewWork(companyId: string, client?: PoolClient): Promise<void> {
    const outstandingByCurrency = await this.receivables.outstandingByCurrency(client ?? null, companyId);
    if (outstandingByCurrency.length === 0) {
      return;
    }

    const details: { outstandingAmount?: Money; outstandingByCurrency: Money[] } =
      outstandingByCurrency.length === 1
        ? { outstandingAmount: outstandingByCurrency[0], outstandingByCurrency }
        : { outstandingByCurrency };

    throw new ApiException(
      409,
      'COMMISSION_OUTSTANDING',
      COMMISSION_OUTSTANDING_MESSAGE,
      details,
    );
  }
}

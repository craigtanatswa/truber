import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { lockCommissionShared } from './commission-lock';
import { Money } from './money';
import { ReceivablesService } from './receivables.service';

export const COMMISSION_OUTSTANDING_MESSAGE =
  'Outstanding commission must be settled before taking new work.';

@Injectable()
export class CommissionGateService {
  constructor(private readonly receivables: ReceivablesService) {}

  /**
   * Blocks new work while any currency still has outstanding commission.
   * Must be called inside the caller's transaction (the quotation/accept/confirm
   * tx), after the ACCOUNT_BANNED guard. The shared lock is held until that tx
   * ends, so a concurrent recognise for the same company waits for the new-work
   * tx and vice versa.
   */
  async assertCanTakeNewWork(client: PoolClient, companyId: string): Promise<void> {
    await lockCommissionShared(client, companyId);
    const outstandingByCurrency = await this.receivables.outstandingByCurrency(client, companyId);
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

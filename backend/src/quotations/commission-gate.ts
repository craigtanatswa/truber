import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * This gate must be called inside the transaction AFTER the ban check.
 * The billing slice replaces NoCommissionRecordsGate with the real commission service.
 */
export abstract class NewWorkCommissionGate {
  abstract assertCanTakeNewWork(client: PoolClient, companyId: string): Promise<void>;
}

@Injectable()
export class NoCommissionRecordsGate extends NewWorkCommissionGate {
  override async assertCanTakeNewWork(_client: PoolClient, _companyId: string): Promise<void> {
    // Main has no commission tables yet. The billing PR binds the real gate here.
  }
}

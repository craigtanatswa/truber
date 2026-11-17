import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * This gate must be called inside the transaction AFTER the ban gate.
 *
 * Per API v0.5.0 the real billing binding must check only `open` receivables'
 * remainingAmount (summarised as outstandingByCurrency). It must EXCLUDE `held`
 * receivables (an open dispute holds them) and must not count credit. On rejection it
 * throws the pinned CommissionOutstandingError with CommissionOutstandingDetails.
 * Billing is not implemented in this slice; the billing slice replaces
 * NoCommissionRecordsGate with the real commission service.
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

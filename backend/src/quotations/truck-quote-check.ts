import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';

export abstract class TruckQuoteCheck {
  abstract assertTruckUsableForQuote(client: PoolClient, companyId: string, truckId: string): Promise<void>;
}

@Injectable()
export class UnavailableTruckQuoteCheck extends TruckQuoteCheck {
  override async assertTruckUsableForQuote(_client: PoolClient, _companyId: string, _truckId: string): Promise<void> {
    // TODO(trucks): bind Brian's trucks module assertTruckUsableForQuote (truck must belong to companyId and be verified).
    throw new ApiException(404, 'NOT_FOUND', 'Truck not found.');
  }
}

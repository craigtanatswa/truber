import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * POD seam.
 *
 * TODO: Brian's POD module (item 4) binds the real check here; until then delivery
 * acceptance is refused because no proof-of-delivery artifact can be found.
 */
export abstract class ProofOfDeliveryCheck {
  abstract hasArtifact(client: PoolClient, bookingId: string): Promise<boolean>;
}

@Injectable()
export class NoProofOfDeliveryCheck extends ProofOfDeliveryCheck {
  override async hasArtifact(_client: PoolClient, _bookingId: string): Promise<boolean> {
    return false;
  }
}

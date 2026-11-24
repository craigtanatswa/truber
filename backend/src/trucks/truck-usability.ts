import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { DbQuery } from '../db/db.service';

export function truckNotInCompanyError(): ApiException {
  return new ApiException(400, 'TRUCK_NOT_IN_COMPANY', 'The truck does not belong to this company.');
}

/**
 * Quoting requires a verified transporter company; if the quote names a truck it must belong to
 * that company and be verified. Pass the transaction client to hold FOR SHARE locks for the rest
 * of the caller's transaction. A missing truck and a truck owned by another company share the same
 * error so responses do not reveal whether a truck id exists.
 */
export async function assertTruckUsableForQuote(
  db: DbQuery | PoolClient,
  companyId: string,
  truckId: string | null | undefined,
): Promise<void> {
  const company = await (db as DbQuery).query<{
    id: string;
    type: string;
    verification_status: string;
  }>('SELECT id, type, verification_status FROM companies WHERE id = $1 FOR SHARE', [companyId]);
  const companyRow = company.rows[0];
  if (
    !companyRow ||
    companyRow.type !== 'transporter' ||
    companyRow.verification_status !== 'verified'
  ) {
    throw new ApiException(
      409,
      'TRANSPORTER_COMPANY_NOT_VERIFIED',
      'The transporter company must be verified before quoting.',
    );
  }

  if (truckId == null) {
    return;
  }

  const truck = await (db as DbQuery).query<{
    company_id: string;
    verification_status: string;
  }>('SELECT company_id, verification_status FROM trucks WHERE id = $1 FOR SHARE', [truckId]);
  const truckRow = truck.rows[0];
  if (!truckRow || truckRow.company_id !== companyId) {
    throw truckNotInCompanyError();
  }
  if (truckRow.verification_status !== 'verified') {
    throw new ApiException(
      409,
      'TRUCK_NOT_VERIFIED',
      'The truck must be verified before quoting.',
    );
  }
}

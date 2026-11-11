import { Injectable } from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DbService } from '../db/db.service';
import { BookingDirectory, BookingParties } from '../offplatform/booking-directory';

const BOOKING_PARTIES = `
  b.id AS "bookingId",
  b.load_id AS "loadId",
  b.status,
  b.shipper_company_id AS "shipperCompanyId",
  b.transporter_company_id AS "transporterCompanyId"
`;

@Injectable()
export class PostgresBookingDirectory extends BookingDirectory {
  override async findById(client: PoolClient | DbService, bookingId: string): Promise<BookingParties | null> {
    const result = await run(client, `SELECT ${BOOKING_PARTIES} FROM bookings b WHERE b.id = $1`, [bookingId]);
    return (result.rows[0] as BookingParties | undefined) ?? null;
  }

  override async findActiveForLoad(client: PoolClient | DbService, loadId: string): Promise<BookingParties | null> {
    const result = await run(
      client,
      `SELECT ${BOOKING_PARTIES}
       FROM bookings b
       WHERE b.load_id = $1 AND b.status <> 'cancelled'
       ORDER BY b.created_at ASC, b.id ASC
       LIMIT 1`,
      [loadId],
    );
    return (result.rows[0] as BookingParties | undefined) ?? null;
  }
}

function run<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | DbService,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return (client as DbService).query<T>(text, params);
}

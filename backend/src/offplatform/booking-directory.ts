import { readFileSync } from 'fs';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export interface BookingParties {
  bookingId: string;
  loadId: string;
  status: 'pending_payment_arrangement' | 'confirmed' | 'cancelled';
  shipperCompanyId: string;
  transporterCompanyId: string;
}

export abstract class BookingDirectory {
  abstract findById(client: PoolClient | DbService, bookingId: string): Promise<BookingParties | null>;
  abstract findActiveForLoad(client: PoolClient | DbService, loadId: string): Promise<BookingParties | null>;
}

// Local demo/evidence only. This stands in for the absent bookings domain and
// re-reads a JSON file of BookingParties on every call. It is never used in
// production: loadEnv and the AppModule provider both refuse it there.
export class DevFixtureBookingDirectory extends BookingDirectory {
  constructor(private readonly filePath: string) {
    super();
  }

  override async findById(_client: PoolClient | DbService, bookingId: string): Promise<BookingParties | null> {
    return this.readFixtures().find((booking) => booking.bookingId === bookingId) ?? null;
  }

  override async findActiveForLoad(_client: PoolClient | DbService, loadId: string): Promise<BookingParties | null> {
    return this.readFixtures().find((booking) => booking.loadId === loadId && booking.status !== 'cancelled') ?? null;
  }

  private readFixtures(): BookingParties[] {
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('DEV_BOOKING_FIXTURES_FILE must contain a JSON array of booking fixtures');
    }
    return parsed as BookingParties[];
  }
}

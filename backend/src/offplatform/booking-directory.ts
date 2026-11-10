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

export class UnavailableBookingDirectory extends BookingDirectory {
  override async findById(_client: PoolClient | DbService, _bookingId: string): Promise<BookingParties | null> {
    // Bookings are not implemented in main yet. When the bookings domain lands it
    // supplies a real BookingDirectory implementation through the AppModule provider.
    return null;
  }

  override async findActiveForLoad(_client: PoolClient | DbService, _loadId: string): Promise<BookingParties | null> {
    // Bookings are not implemented in main yet. When the bookings domain lands it
    // supplies a real BookingDirectory implementation through the AppModule provider.
    return null;
  }
}

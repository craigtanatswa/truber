import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';

export type BookingNotificationType =
  | 'dispute_opened'
  | 'dispute_responded'
  | 'dispute_settled'
  | 'dispute_resolved';

export interface BookingNotificationEvent {
  type: BookingNotificationType;
  bookingId: string;
  disputeId: string;
  recipientCompanyIds: string[];
}

export abstract class BookingNotifications {
  abstract record(client: PoolClient, event: BookingNotificationEvent): Promise<void>;
}

/**
 * Transactional outbox. Rows are recorded for the configured notification channel to
 * deliver later; this slice never sends an email or SMS itself.
 */
@Injectable()
export class OutboxBookingNotifications extends BookingNotifications {
  override async record(client: PoolClient, event: BookingNotificationEvent): Promise<void> {
    const recipients = [...new Set(event.recipientCompanyIds)];
    for (const companyId of recipients) {
      await client.query(
        `INSERT INTO notification_events (
           id, event_type, booking_id, dispute_id, recipient_company_id, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, clock_timestamp())`,
        [
          randomUUID(),
          event.type,
          event.bookingId,
          event.disputeId,
          companyId,
          JSON.stringify({
            event: event.type,
            bookingId: event.bookingId,
            disputeId: event.disputeId,
          }),
        ],
      );
    }
  }
}

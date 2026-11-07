import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ENV, Env } from '../config/env';
import { DbService } from '../db/db.service';

export type DeliveryKind = 'password_reset' | 'otp';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  async stage(kind: DeliveryKind, recipient: string, userId: string, secret: string): Promise<void> {
    if (this.env.DELIVERY_ADAPTER !== 'dev') {
      this.logger.log(`delivery suppressed kind=${kind}`);
      return;
    }
    await this.db.query(
      `INSERT INTO delivery_outbox (id, kind, recipient, user_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
      [randomUUID(), kind, recipient, userId, secret],
    );
    this.logger.log(`delivery staged kind=${kind}`);
  }
}

import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class RateLimitService {
  constructor(private readonly db: DbService) {}

  async hit(key: string, max: number, windowSeconds: number): Promise<boolean> {
    const result = await this.db.query<{ hit_count: number }>(
      `INSERT INTO rate_limit_buckets AS b (bucket_key, window_start, hit_count)
       VALUES ($1, clock_timestamp(), 1)
       ON CONFLICT (bucket_key) DO UPDATE
       SET
         window_start = CASE
           WHEN b.window_start + make_interval(secs => $2::int) <= clock_timestamp() THEN clock_timestamp()
           ELSE b.window_start
         END,
         hit_count = CASE
           WHEN b.window_start + make_interval(secs => $2::int) <= clock_timestamp() THEN 1
           ELSE b.hit_count + 1
         END
       RETURNING hit_count`,
      [key, windowSeconds],
    );
    return result.rows[0].hit_count <= max;
  }
}

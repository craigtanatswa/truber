import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { iso } from '../common/crypto';
import { DbQuery, DbService } from '../db/db.service';
import { DbUser, UserDetailResponse } from '../domain';
import { presentUser } from '../present';
import { isAllowedAccountStatusTransition, revokesSessions } from './account-status';
import { UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  async get(actor: DbUser, userId: string): Promise<UserDetailResponse> {
    const result = await this.db.query<DbUser>('SELECT * FROM users WHERE id = $1', [userId]);
    const target = result.rows[0];
    if (actor.role === 'admin') {
      if (!target) {
        throw new ApiException(404, 'NOT_FOUND', 'User not found.');
      }
      return this.present(this.db, target);
    }
    if (!target) {
      throw new ApiException(403, 'FORBIDDEN', 'Not permitted to view this user.');
    }
    if (target.id !== actor.id) {
      const shared = await this.db.query(
        `SELECT 1
         FROM company_members a
         JOIN company_members b ON a.company_id = b.company_id
         WHERE a.user_id = $1 AND b.user_id = $2`,
        [actor.id, target.id],
      );
      if (!shared.rowCount) {
        throw new ApiException(403, 'FORBIDDEN', 'Not permitted to view this user.');
      }
    }
    return this.present(this.db, target);
  }

  async update(actor: DbUser, userId: string, dto: UpdateUserDto): Promise<UserDetailResponse> {
    if (actor.role !== 'admin') {
      return this.db.tx(async (client) => {
        if (userId !== actor.id) {
          throw new ApiException(403, 'FORBIDDEN', 'You can only update your own profile.');
        }
        if (dto.accountStatus !== undefined) {
          throw new ApiException(403, 'ACCOUNT_STATUS_ADMIN_ONLY', 'Only an admin can change account status.');
        }
        const locked = await client.query<DbUser>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const target = locked.rows[0];
        if (!target) {
          throw new ApiException(404, 'NOT_FOUND', 'User not found.');
        }
        return this.applyUpdate(client, actor, target, dto);
      });
    }

    return this.db.tx(async (client) => {
      const locked = await client.query<DbUser>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const target = locked.rows[0];
      if (!target) {
        throw new ApiException(404, 'NOT_FOUND', 'User not found.');
      }
      if (target.id === actor.id && dto.accountStatus !== undefined) {
        throw new ApiException(
          403,
          'ADMIN_STATUS_CHANGE_FORBIDDEN',
          'Admins cannot change their own account status.',
        );
      }
      if (target.id !== actor.id && target.role === 'admin') {
        throw new ApiException(
          403,
          'ADMIN_STATUS_CHANGE_FORBIDDEN',
          'Admins cannot change another admin account.',
        );
      }
      return this.applyUpdate(client, actor, target, dto);
    });
  }

  private async applyUpdate(
    client: PoolClient,
    actor: DbUser,
    target: DbUser,
    dto: UpdateUserDto,
  ): Promise<UserDetailResponse> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (fullName.length === 0) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
          fields: { fullName: 'must contain at least one character' },
        });
      }
      assign('full_name', fullName);
    }
    if (dto.phone !== undefined) {
      assign('phone', blankToNull(dto.phone));
    }
    if (dto.accountStatus !== undefined && dto.accountStatus !== target.account_status) {
      const to = dto.accountStatus;
      if (!isAllowedAccountStatusTransition(target.account_status, to)) {
        throw new ApiException(
          400,
          'INVALID_ACCOUNT_STATUS_TRANSITION',
          'This account status change is not allowed.',
        );
      }
      assign('account_status', to);
      await client.query(
        `INSERT INTO account_status_changes (
           id, user_id, from_status, to_status, changed_by_user_id, changed_at
         ) VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
        [randomUUID(), target.id, target.account_status, to, actor.id],
      );
      if (revokesSessions(to)) {
        await client.query(
          'UPDATE refresh_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL',
          [target.id],
        );
      }
    }

    if (sets.length === 0) {
      return this.present(client, target);
    }
    sets.push('updated_at = clock_timestamp()');
    params.push(target.id);
    const updated = await client.query<DbUser>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return this.present(client, updated.rows[0]);
  }

  private async present(client: DbQuery | PoolClient, user: DbUser): Promise<UserDetailResponse> {
    const result = await (client as DbQuery).query<{ banned_until: Date | string | null }>(
      `SELECT max(ends_at) AS banned_until
       FROM off_platform_bans
       WHERE user_id = $1
         AND lifted_at IS NULL
         AND starts_at <= clock_timestamp()
         AND clock_timestamp() < ends_at`,
      [user.id],
    );
    const bannedUntil = result.rows[0]?.banned_until ?? null;
    return {
      ...presentUser(user),
      bannedUntil: bannedUntil == null ? null : iso(bannedUntil),
    };
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

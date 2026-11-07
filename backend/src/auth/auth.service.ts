import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { ENV, Env } from '../config/env';
import { hashPassword, randomOtpCode, randomToken, sha256, verifyPassword } from '../common/crypto';
import { ApiException, isPgError } from '../common/api.exception';
import { DbService } from '../db/db.service';
import { DeliveryService } from '../delivery/delivery.service';
import { RateLimitService } from '../delivery/rate-limit.service';
import { AccountStatus, AuthTokenResponseBody, DbUser, UserResponse, UserRole } from '../domain';
import { presentUser } from '../present';
import { PoolClient } from 'pg';
import {
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RegisterDto,
  VerifyOtpDto,
} from './auth.dto';

const RESET_ACCEPTED = {
  status: 'accepted' as const,
  message: 'If an account exists for this email, password reset instructions will be sent when permitted.',
};

const RESET_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESET_TOKEN_RE = /^\S{32,512}$/;

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly delivery: DeliveryService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokenResponseBody> {
    const email = normalizeEmail(dto.email);
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.db.tx(async (client) => {
        const inserted = await client.query<DbUser>(
          `INSERT INTO users (
             id, email, password_hash, full_name, phone, city, role, account_status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_verification', clock_timestamp(), clock_timestamp())
           RETURNING *`,
          [randomUUID(), email, passwordHash, dto.fullName.trim(), dto.phone?.trim() ?? null, dto.city?.trim() ?? null, dto.role],
        );
        return this.issueTokens(client, inserted.rows[0], randomUUID());
      });
    } catch (error) {
      if (isPgError(error) && error.code === '23505') {
        throw new ApiException(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseBody> {
    const email = normalizeEmail(dto.email);
    const user = await this.findByEmail(email);
    const hash = user?.password_hash ?? (await this.getDummyHash());
    const passwordOk = await verifyPassword(dto.password, hash);
    if (!user || !passwordOk) {
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    if (user.account_status === 'suspended') {
      throw new ApiException(403, 'ACCOUNT_SUSPENDED', 'This account cannot sign in.');
    }
    if (user.account_status === 'disabled') {
      throw new ApiException(403, 'ACCOUNT_DISABLED', 'This account cannot sign in.');
    }
    return this.db.tx(async (client) => this.issueTokens(client, user, randomUUID()));
  }

  async refresh(refreshToken: string): Promise<AuthTokenResponseBody> {
    const hash = sha256(refreshToken);
    const rotated = await this.db.tx(async (client) => {
      const locked = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        consumed_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT id, user_id, family_id, consumed_at, revoked_at, expires_at
         FROM refresh_sessions
         WHERE token_hash = $1
         FOR UPDATE`,
        [hash],
      );
      const session = locked.rows[0];
      const usable =
        session &&
        session.consumed_at == null &&
        session.revoked_at == null &&
        session.expires_at.getTime() > Date.now();
      if (!session || !usable) {
        return null;
      }
      const userResult = await client.query<DbUser>('SELECT * FROM users WHERE id = $1', [session.user_id]);
      const user = userResult.rows[0];
      if (!user || user.account_status === 'suspended' || user.account_status === 'disabled') {
        await client.query('UPDATE refresh_sessions SET revoked_at = clock_timestamp() WHERE id = $1', [session.id]);
        return null;
      }
      await client.query('UPDATE refresh_sessions SET consumed_at = clock_timestamp() WHERE id = $1', [session.id]);
      return this.issueTokens(client, user, session.family_id, session.id);
    });
    if (!rotated) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    return rotated;
  }

  async me(user: DbUser): Promise<UserResponse> {
    const fresh = await this.db.query<DbUser>('SELECT * FROM users WHERE id = $1', [user.id]);
    return presentUser(fresh.rows[0] ?? user);
  }

  async requestPasswordReset(dto: PasswordResetRequestDto, source: string): Promise<typeof RESET_ACCEPTED> {
    if (!RESET_EMAIL_RE.test(dto.email.trim())) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
        fields: { email: 'must be an email address' },
      });
    }
    const allowed = await this.rateLimit.hit(
      `pwreset:${source}`,
      this.env.RESET_SOURCE_MAX,
      this.env.RESET_SOURCE_WINDOW_SECONDS,
    );
    if (!allowed) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many requests from this source.', undefined, {
        retryAfterSeconds: this.env.RESET_SOURCE_WINDOW_SECONDS,
      });
    }
    const email = normalizeEmail(dto.email);
    const user = await this.findByEmail(email);
    if (user && user.account_status !== 'disabled') {
      const open = await this.db.query(
        `SELECT 1 FROM password_reset_tokens
         WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`,
        [user.id],
      );
      if (!open.rowCount) {
        const token = randomToken(32);
        await this.db.query(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, clock_timestamp())`,
          [randomUUID(), user.id, sha256(token), new Date(Date.now() + this.env.RESET_TOKEN_TTL_SECONDS * 1000)],
        );
        await this.delivery.stage('password_reset', user.email, user.id, token);
      }
    } else {
      sha256(randomToken(32));
    }
    return RESET_ACCEPTED;
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto, source: string): Promise<{ status: 'password_changed'; refreshSessionsInvalidated: true }> {
    const allowed = await this.rateLimit.hit(
      `pwconfirm:${source}`,
      this.env.CONFIRM_SOURCE_MAX,
      this.env.CONFIRM_SOURCE_WINDOW_SECONDS,
    );
    if (!allowed) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many requests from this source.', undefined, {
        retryAfterSeconds: this.env.CONFIRM_SOURCE_WINDOW_SECONDS,
      });
    }
    if (!RESET_TOKEN_RE.test(dto.token)) {
      throw resetTokenError();
    }
    const passwordHash = await hashPassword(dto.newPassword);
    const tokenHash = sha256(dto.token);
    const changed = await this.db.tx(async (client) => {
      const consumed = await client.query<{ user_id: string }>(
        `UPDATE password_reset_tokens
         SET consumed_at = clock_timestamp()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING user_id`,
        [tokenHash],
      );
      const userId = consumed.rows[0]?.user_id;
      if (!userId) {
        return false;
      }
      await client.query('UPDATE users SET password_hash = $2, updated_at = clock_timestamp() WHERE id = $1', [
        userId,
        passwordHash,
      ]);
      await client.query(
        'UPDATE refresh_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
      return true;
    });
    if (!changed) {
      throw resetTokenError();
    }
    return { status: 'password_changed', refreshSessionsInvalidated: true };
  }

  async requestOtp(user: DbUser, channel: 'sms' | 'email', source: string): Promise<{ status: 'stubbed'; expiresInSeconds: number }> {
    assertAccountCanAuthenticate(user.account_status);
    const [sourceOk, userOk] = await Promise.all([
      this.rateLimit.hit(`otp-src:${source}`, this.env.OTP_SOURCE_MAX, this.env.OTP_SOURCE_WINDOW_SECONDS),
      this.rateLimit.hit(`otp-user:${user.id}`, this.env.OTP_SOURCE_MAX, this.env.OTP_SOURCE_WINDOW_SECONDS),
    ]);
    if (!sourceOk || !userOk) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many requests from this source.', undefined, {
        retryAfterSeconds: this.env.OTP_SOURCE_WINDOW_SECONDS,
      });
    }
    const code = randomOtpCode();
    await this.db.tx(async (client) => {
      await client.query(
        `UPDATE otp_challenges SET consumed_at = clock_timestamp()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id],
      );
      await client.query(
        `INSERT INTO otp_challenges (id, user_id, channel, code_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
        [randomUUID(), user.id, channel, sha256(`${user.id}:${code}`), new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000)],
      );
    });
    const recipient = channel === 'email' ? user.email : user.phone ?? user.email;
    await this.delivery.stage('otp', recipient, user.id, code);
    return { status: 'stubbed', expiresInSeconds: this.env.OTP_TTL_SECONDS };
  }

  async verifyOtp(user: DbUser, dto: VerifyOtpDto): Promise<UserResponse> {
    if (user.account_status === 'suspended' || user.account_status === 'disabled') {
      throw new ApiException(409, 'ACCOUNT_NOT_ELIGIBLE', 'This account cannot be verified.');
    }
    const allowed = await this.rateLimit.hit(
      `otp-verify:${user.id}`,
      this.env.OTP_VERIFY_MAX,
      this.env.OTP_VERIFY_WINDOW_SECONDS,
    );
    if (!allowed) {
      throw new ApiException(429, 'RATE_LIMITED', 'Too many requests from this source.', undefined, {
        retryAfterSeconds: this.env.OTP_VERIFY_WINDOW_SECONDS,
      });
    }
    const codeHash = sha256(`${user.id}:${dto.code}`);
    return this.db.tx(async (client) => {
      const consumed = await client.query(
        `UPDATE otp_challenges
         SET consumed_at = clock_timestamp()
         WHERE id = (
           SELECT id FROM otp_challenges
           WHERE user_id = $1
             AND code_hash = $2
             AND consumed_at IS NULL
             AND expires_at > clock_timestamp()
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE
         )
         RETURNING id`,
        [user.id, codeHash],
      );
      if (!consumed.rowCount) {
        throw new ApiException(401, 'OTP_INVALID', 'OTP is invalid or no longer usable.');
      }
      const fresh = await client.query<DbUser>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const current = fresh.rows[0];
      if (current.account_status === 'pending_verification') {
        const updated = await client.query<DbUser>(
          `UPDATE users
           SET account_status = 'active', updated_at = clock_timestamp()
           WHERE id = $1
           RETURNING *`,
          [user.id],
        );
        return presentUser(updated.rows[0]);
      }
      return presentUser(current);
    });
  }

  private async issueTokens(client: PoolClient, user: DbUser, familyId: string, replacesId?: string): Promise<AuthTokenResponseBody> {
    const refreshToken = randomToken(32);
    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO refresh_sessions (id, user_id, token_hash, family_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
      [sessionId, user.id, sha256(refreshToken), familyId, new Date(Date.now() + this.env.REFRESH_TTL_SECONDS * 1000)],
    );
    if (replacesId) {
      await client.query('UPDATE refresh_sessions SET replaced_by = $2 WHERE id = $1', [replacesId, sessionId]);
    }
    const accessToken = jwt.sign({ sub: user.id, role: user.role satisfies UserRole }, this.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      user: presentUser(user),
    };
  }

  private async findByEmail(email: string): Promise<DbUser | null> {
    const result = await this.db.query<DbUser>('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] ?? null;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomToken(24));
    return this.dummyHash;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertAccountCanAuthenticate(status: AccountStatus): void {
  if (status === 'suspended' || status === 'disabled') {
    throw new ApiException(403, 'ACCOUNT_NOT_PERMITTED', 'This account cannot perform this action.');
  }
}

function resetTokenError(): ApiException {
  return new ApiException(
    401,
    'PASSWORD_RESET_TOKEN_INVALID',
    'Password reset token is invalid or no longer usable.',
    undefined,
    { exactBody: true },
  );
}

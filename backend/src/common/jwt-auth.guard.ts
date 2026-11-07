import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ENV, Env } from '../config/env';
import { DbUser } from '../domain';
import { DbService } from '../db/db.service';
import { ApiException } from './api.exception';
import { AuthedRequest } from './http';

interface AccessClaims {
  sub?: unknown;
  role?: unknown;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    let claims: AccessClaims;
    try {
      const verified = jwt.verify(token, this.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      if (typeof verified === 'string') {
        throw new Error('unexpected jwt payload');
      }
      claims = verified;
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    if (typeof claims.sub !== 'string' || typeof claims.role !== 'string') {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    const found = await this.db.query<DbUser>('SELECT * FROM users WHERE id = $1', [claims.sub]);
    const user = found.rows[0];
    if (!user || user.role !== claims.role) {
      throw new ApiException(401, 'UNAUTHORIZED', 'Authentication required.');
    }
    if (user.account_status === 'suspended' || user.account_status === 'disabled') {
      throw new ApiException(403, 'ACCOUNT_NOT_PERMITTED', 'This account cannot perform this action.');
    }
    req.user = user;
    return true;
  }
}

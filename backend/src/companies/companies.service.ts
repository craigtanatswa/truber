import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ApiException } from '../common/api.exception';
import { pageMeta, pageWindow } from '../common/http';
import { DbService } from '../db/db.service';
import { CompanyResponse, DbUser, VerificationStatus } from '../domain';
import { presentCompany } from '../present';
import { CreateCompanyDto, ListCompaniesQueryDto, UpdateCompanyDto } from './companies.dto';

const COMPANY_COLUMNS = `
  id, type, legal_name, trading_name, registration_number, tax_number,
  country_code, city, verification_status, created_at, updated_at
`;

@Injectable()
export class CompaniesService {
  constructor(private readonly db: DbService) {}

  async list(actor: DbUser, query: ListCompaniesQueryDto): Promise<{ data: CompanyResponse[]; meta: ReturnType<typeof pageMeta> }> {
    const window = pageWindow(query.page, query.pageSize);
    const where: string[] = [];
    const params: unknown[] = [];
    if (actor.role !== 'admin') {
      params.push(actor.id);
      where.push(`id IN (SELECT company_id FROM company_members WHERE user_id = $${params.length})`);
    }
    if (query.type) {
      params.push(query.type);
      where.push(`type = $${params.length}`);
    }
    if (query.verificationStatus) {
      params.push(query.verificationStatus);
      where.push(`verification_status = $${params.length}`);
    }
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    const total = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM companies WHERE ${clause}`, params);
    const listParams = [...params, window.pageSize, window.offset];
    const rows = await this.db.query(
      `SELECT ${COMPANY_COLUMNS}
       FROM companies
       WHERE ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    );
    return {
      data: rows.rows.map((row) => presentCompany(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  async create(actor: DbUser, dto: CreateCompanyDto): Promise<CompanyResponse> {
    const ownerId = await this.resolveOwner(actor, dto);
    const id = randomUUID();
    const created = await this.db.tx(async (client) => {
      const company = await client.query(
        `INSERT INTO companies (
           id, type, legal_name, trading_name, registration_number, tax_number,
           country_code, city, verification_status, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'unverified', clock_timestamp(), clock_timestamp()
         ) RETURNING ${COMPANY_COLUMNS}`,
        [
          id,
          dto.type,
          dto.legalName.trim(),
          blankToNull(dto.tradingName),
          blankToNull(dto.registrationNumber),
          blankToNull(dto.taxNumber),
          (dto.countryCode ?? 'ZW').toUpperCase(),
          dto.city?.trim() ?? null,
        ],
      );
      await client.query(
        `INSERT INTO company_members (company_id, user_id, member_role, created_at)
         VALUES ($1, $2, 'owner', clock_timestamp())`,
        [id, ownerId],
      );
      return company.rows[0];
    });
    return presentCompany(created);
  }

  async get(actor: DbUser, companyId: string): Promise<CompanyResponse> {
    const row = await this.requireVisible(actor, companyId);
    return presentCompany(row);
  }

  async update(actor: DbUser, companyId: string, dto: UpdateCompanyDto): Promise<CompanyResponse> {
    if (dto.verificationStatus !== undefined && actor.role !== 'admin') {
      throw new ApiException(403, 'VERIFICATION_ADMIN_ONLY', 'Only an admin can change verification status.');
    }
    return this.db.tx(async (client) => {
      const existing = await this.lockVisible(client, actor, companyId);
      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.legalName !== undefined) assign('legal_name', dto.legalName.trim());
      if (dto.tradingName !== undefined) assign('trading_name', blankToNull(dto.tradingName));
      if (dto.registrationNumber !== undefined) assign('registration_number', blankToNull(dto.registrationNumber));
      if (dto.taxNumber !== undefined) assign('tax_number', blankToNull(dto.taxNumber));
      if (dto.city !== undefined) assign('city', dto.city === null ? null : dto.city.trim());
      if (dto.verificationStatus !== undefined) assign('verification_status', dto.verificationStatus satisfies VerificationStatus);
      if (sets.length === 0) {
        return presentCompany(existing);
      }
      sets.push('updated_at = clock_timestamp()');
      params.push(companyId);
      const updated = await client.query(
        `UPDATE companies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COMPANY_COLUMNS}`,
        params,
      );
      return presentCompany(updated.rows[0]);
    });
  }

  private async resolveOwner(actor: DbUser, dto: CreateCompanyDto): Promise<string> {
    if (actor.role !== 'admin') {
      if (dto.ownerUserId) {
        throw new ApiException(403, 'OWNER_OVERRIDE_ADMIN_ONLY', 'Only an admin can set ownerUserId.');
      }
      if (actor.role !== dto.type) {
        throw new ApiException(403, 'ROLE_COMPANY_TYPE_MISMATCH', 'Company type must match the caller role.');
      }
      return actor.id;
    }
    const ownerId = dto.ownerUserId ?? actor.id;
    const owner = await this.db.query<DbUser>('SELECT * FROM users WHERE id = $1', [ownerId]);
    const user = owner.rows[0];
    if (!user) {
      throw new ApiException(404, 'NOT_FOUND', 'User not found.');
    }
    if (user.role !== 'admin' && user.role !== dto.type) {
      throw new ApiException(403, 'ROLE_COMPANY_TYPE_MISMATCH', 'Company type must match the owner role.');
    }
    return ownerId;
  }

  private async requireVisible(actor: DbUser, companyId: string) {
    const result = await this.db.query(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1`, [companyId]);
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      const member = await this.db.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
        companyId,
        actor.id,
      ]);
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }
    return row;
  }

  private async lockVisible(client: PoolClient, actor: DbUser, companyId: string) {
    const result = await client.query(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1 FOR UPDATE`, [companyId]);
    const row = result.rows[0];
    if (!row) {
      throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
    }
    if (actor.role !== 'admin') {
      const member = await client.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [
        companyId,
        actor.id,
      ]);
      if (!member.rowCount) {
        throw new ApiException(404, 'NOT_FOUND', 'Company not found.');
      }
    }
    return row;
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

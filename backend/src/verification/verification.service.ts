import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiException } from '../common/api.exception';
import { sha256 } from '../common/crypto';
import { pageMeta, pageWindow } from '../common/http';
import {
  assertIdempotencyKey,
  readIdempotency,
  storeIdempotency,
} from '../common/idempotency';
import { ENV, Env } from '../config/env';
import { DbService } from '../db/db.service';
import { DbUser, VerificationDocumentResponse } from '../domain';
import { presentVerificationDocument } from '../present';
import { truckNotInCompanyError } from '../trucks/truck-usability';
import { assertAllowedDocumentUri } from './document-uri';
import {
  CreateVerificationDocumentDto,
  ListVerificationDocumentsQueryDto,
  ReviewVerificationDocumentDto,
} from './verification.dto';

const DOCUMENT_COLUMNS = `
  id, owner_user_id, company_id, truck_id, document_type, document_uri, status,
  review_notes, reviewed_by_user_id, reviewed_at, created_at
`;

interface DocumentListFilter {
  companyId?: string;
}

interface DocumentVisibility {
  actor: DbUser;
  companyId?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  async list(
    actor: DbUser,
    query: ListVerificationDocumentsQueryDto,
  ): Promise<{ data: VerificationDocumentResponse[]; meta: ReturnType<typeof pageMeta> }> {
    const window = pageWindow(query.page, query.pageSize);
    const filter: DocumentListFilter = { companyId: query.companyId };
    let scopedCompanyId: string | undefined;
    if (actor.role !== 'admin' && query.companyId) {
      const member = await this.db.query(
        'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
        [query.companyId, actor.id],
      );
      if (!member.rowCount) {
        throw new ApiException(403, 'FORBIDDEN', 'Not a member of this company.');
      }
      scopedCompanyId = query.companyId;
    }

    const { clause, params } = this.buildWhere(filter, { actor, companyId: scopedCompanyId });
    const total = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM verification_documents WHERE ${clause}`,
      params,
    );
    const rows = await this.db.query(
      `SELECT ${DOCUMENT_COLUMNS}
       FROM verification_documents
       WHERE ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, window.pageSize, window.offset],
    );
    return {
      data: rows.rows.map((row) => presentVerificationDocument(row)),
      meta: pageMeta(window.page, window.pageSize, total.rows[0]?.total ?? 0),
    };
  }

  private buildWhere(
    filter: DocumentListFilter,
    visibility: DocumentVisibility,
  ): { clause: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (visibility.companyId) {
      params.push(visibility.companyId);
      where.push(`company_id = $${params.length}`);
    } else if (visibility.actor.role !== 'admin') {
      params.push(visibility.actor.id);
      where.push(
        `(owner_user_id = $${params.length} OR company_id IN (
          SELECT company_id FROM company_members WHERE user_id = $${params.length}
        ))`,
      );
    }
    if (filter.companyId && filter.companyId !== visibility.companyId) {
      params.push(filter.companyId);
      where.push(`company_id = $${params.length}`);
    }
    const clause = where.length > 0 ? where.join(' AND ') : 'TRUE';
    return { clause, params };
  }

  async upload(actor: DbUser, dto: CreateVerificationDocumentDto): Promise<VerificationDocumentResponse> {
    assertAllowedDocumentUri(dto.documentUri, this.env.verificationDocUriHosts);
    return this.db.tx(async (client) => {
      let companyId = dto.companyId ?? null;
      const truckId = dto.truckId ?? null;

      if (truckId) {
        const truck = await client.query<{ id: string; company_id: string }>(
          'SELECT id, company_id FROM trucks WHERE id = $1 FOR UPDATE',
          [truckId],
        );
        const truckRow = truck.rows[0];
        // A foreign truck and an unknown truck id must be indistinguishable.
        if (!truckRow) {
          throw truckNotInCompanyError();
        }
        if (actor.role !== 'admin') {
          const member = await client.query(
            'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
            [truckRow.company_id, actor.id],
          );
          if (!member.rowCount) {
            throw truckNotInCompanyError();
          }
        }
        if (dto.companyId !== undefined && dto.companyId !== truckRow.company_id) {
          throw truckNotInCompanyError();
        }
        companyId = truckRow.company_id;
      } else if (companyId) {
        const company = await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [
          companyId,
        ]);
        let permitted = Boolean(company.rows[0]);
        if (permitted && actor.role !== 'admin') {
          const member = await client.query(
            'SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2',
            [companyId, actor.id],
          );
          permitted = Boolean(member.rowCount);
        }
        if (!permitted) {
          throw new ApiException(403, 'FORBIDDEN', 'Not a member of this company.');
        }
      }

      const inserted = await client.query(
        `INSERT INTO verification_documents (
           id, owner_user_id, company_id, truck_id, document_type, document_uri, status,
           review_notes, reviewed_by_user_id, reviewed_at, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'submitted', NULL, NULL, NULL, clock_timestamp()
         ) RETURNING ${DOCUMENT_COLUMNS}`,
        [randomUUID(), actor.id, companyId, truckId, dto.documentType, dto.documentUri],
      );

      if (truckId) {
        await client.query(
          `UPDATE trucks
           SET verification_status = 'pending', updated_at = clock_timestamp()
           WHERE id = $1 AND verification_status IN ('unverified', 'rejected')`,
          [truckId],
        );
      } else if (companyId) {
        await client.query(
          `UPDATE companies
           SET verification_status = 'pending', updated_at = clock_timestamp()
           WHERE id = $1 AND verification_status IN ('unverified', 'rejected')`,
          [companyId],
        );
      }

      return presentVerificationDocument(inserted.rows[0]);
    });
  }

  async review(
    actor: DbUser,
    documentId: string,
    dto: ReviewVerificationDocumentDto,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: VerificationDocumentResponse }> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = sha256(
      JSON.stringify({
        op: 'reviewVerificationDocument',
        documentId,
        decision: dto.decision,
        reviewNotes: dto.reviewNotes ?? null,
        setCompanyVerified: dto.setCompanyVerified ?? false,
        setTruckVerified: dto.setTruckVerified ?? false,
      }),
    );
    return this.db.tx(async (client) => {
      const replay = await readIdempotency<VerificationDocumentResponse>(
        client,
        actor.id,
        idempotencyKey,
        'reviewVerificationDocument',
        requestHash,
      );
      if (replay) return replay;

      const locked = await client.query(
        `SELECT ${DOCUMENT_COLUMNS} FROM verification_documents WHERE id = $1 FOR UPDATE`,
        [documentId],
      );
      const document = locked.rows[0];
      if (!document) {
        throw new ApiException(404, 'NOT_FOUND', 'Verification document not found.');
      }
      if (document.status !== 'submitted') {
        throw new ApiException(
          409,
          'DOCUMENT_ALREADY_REVIEWED',
          'This document has already been reviewed.',
        );
      }
      if (dto.decision === 'rejected' && (dto.setCompanyVerified || dto.setTruckVerified)) {
        throw new ApiException(
          409,
          'REVIEW_FLAGS_REQUIRE_APPROVAL',
          'Verification flags can only be set when approving.',
        );
      }
      if (dto.setTruckVerified && document.truck_id == null) {
        throw new ApiException(409, 'DOCUMENT_HAS_NO_TRUCK', 'This document is not linked to a truck.');
      }
      if (dto.setCompanyVerified && document.company_id == null) {
        throw new ApiException(
          409,
          'DOCUMENT_HAS_NO_COMPANY',
          'This document is not linked to a company.',
        );
      }

      const reviewNotes = blankToNull(dto.reviewNotes);
      const updated = await client.query(
        `UPDATE verification_documents
         SET status = $2,
             review_notes = $3,
             reviewed_by_user_id = $4,
             reviewed_at = clock_timestamp()
         WHERE id = $1
         RETURNING ${DOCUMENT_COLUMNS}`,
        [documentId, dto.decision, reviewNotes, actor.id],
      );

      if (dto.decision === 'approved' && dto.setTruckVerified) {
        await client.query(
          `UPDATE trucks
           SET verification_status = 'verified', updated_at = clock_timestamp()
           WHERE id = $1`,
          [document.truck_id],
        );
      }
      if (dto.decision === 'approved' && dto.setCompanyVerified) {
        await client.query(
          `UPDATE companies
           SET verification_status = 'verified', updated_at = clock_timestamp()
           WHERE id = $1`,
          [document.company_id],
        );
      }

      const body = presentVerificationDocument(updated.rows[0]);
      await storeIdempotency(
        client,
        actor.id,
        idempotencyKey,
        'reviewVerificationDocument',
        requestHash,
        200,
        body,
      );
      return { status: 200, body };
    });
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

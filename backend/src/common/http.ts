import { Request } from 'express';
import { ApiException } from './api.exception';
import { DbUser } from '../domain';

export interface AuthedRequest extends Request {
  user: DbUser;
  requestId: string;
}

export function sourceKey(req: Request): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return ip.replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 80);
}

export function singleHeader(value: string | string[] | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { [field]: 'provide a single header value' },
    });
  }
  return value;
}

export function pageWindow(page: number | undefined, pageSize: number | undefined): { page: number; pageSize: number; offset: number } {
  const resolvedPage = page ?? 1;
  const resolvedSize = pageSize ?? 20;
  return { page: resolvedPage, pageSize: resolvedSize, offset: (resolvedPage - 1) * resolvedSize };
}

export function pageMeta(page: number, pageSize: number, totalItems: number): { page: number; pageSize: number; totalItems: number; totalPages: number } {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

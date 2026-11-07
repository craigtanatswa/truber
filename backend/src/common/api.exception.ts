import { HttpException } from '@nestjs/common';

export interface ApiExceptionOptions {
  exactBody?: boolean;
  retryAfterSeconds?: number;
}

export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly extra?: ApiExceptionOptions,
  ) {
    super(message, status);
  }
}

export function isPgError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string';
}

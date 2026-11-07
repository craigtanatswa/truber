import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiException } from './api.exception';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      out[path] = Object.values(error.constraints).join('; ');
    }
    if (error.children && error.children.length > 0) {
      Object.assign(out, flattenValidationErrors(error.children, path));
    }
  }
  return out;
}

export function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) => {
      const fields = flattenValidationErrors(errors);
      if (Object.keys(fields).length === 0) {
        return new BadRequestException('Request validation failed');
      }
      return new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', { fields });
    },
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertCalendarDate(value: string, field: string): string {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { [field]: 'must be a calendar date YYYY-MM-DD' },
    });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { [field]: 'must be a real calendar date' },
    });
  }
  return value;
}

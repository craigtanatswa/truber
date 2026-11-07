import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from './api.exception';

interface RequestWithId {
  requestId?: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const requestId = request.requestId ?? 'unknown';

    if (exception instanceof ApiException) {
      if (exception.extra?.retryAfterSeconds) {
        response.setHeader('Retry-After', String(exception.extra.retryAfterSeconds));
      }
      if (exception.extra?.exactBody) {
        response.status(exception.getStatus()).json({
          code: exception.code,
          message: exception.message,
        });
        return;
      }
      const body: Record<string, unknown> = {
        code: exception.code,
        message: exception.message,
        requestId,
      };
      if (exception.details) {
        body.details = exception.details;
      }
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let message = 'Request failed';
      if (typeof raw === 'string') {
        message = raw;
      } else if (typeof raw === 'object' && raw !== null && 'message' in raw) {
        const inner = (raw as { message: unknown }).message;
        message = Array.isArray(inner) ? inner.map(String).join('; ') : String(inner);
      }
      const code = status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR';
      response.status(status).json({
        code,
        message: status === 404 ? 'Resource not found.' : message,
        requestId,
      });
      return;
    }

    if (exception instanceof SyntaxError) {
      response.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Malformed JSON',
        requestId,
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : 'Unhandled error');
    response.status(500).json({
      code: 'INTERNAL',
      message: 'Internal server error.',
      requestId,
    });
  }
}

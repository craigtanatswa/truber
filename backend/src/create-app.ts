import 'reflect-metadata';
import { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Express, json } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { validationPipe } from './common/validation';
import { ENV, Env } from './config/env';

export async function createApp(options?: { logger?: LoggerService | false }): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: options?.logger ?? ['error', 'warn', 'log'],
    bodyParser: false,
    // Throw on a failed boot instead of calling process.exit, so the serverless handler can answer 503.
    abortOnError: false,
  });
  const env = app.get<Env>(ENV);
  if (env.CLIENT_IP_SOURCE === 'vercel') {
    // Vercel's edge overwrites X-Forwarded-For with the client address, so trust exactly one hop.
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  }
  if (env.corsOrigins.length > 0) {
    // Exact-match allowlist. Auth is a bearer header, so no cookies and no credentials.
    app.enableCors({
      origin: env.corsOrigins,
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    });
  }
  app.use(json({ limit: '32kb' }));
  app.use(requestIdMiddleware);
  app.useGlobalPipes(validationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}

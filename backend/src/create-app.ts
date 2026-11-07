import 'reflect-metadata';
import { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { validationPipe } from './common/validation';

export async function createApp(options?: { logger?: LoggerService | false }): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: options?.logger ?? ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.use(json({ limit: '32kb' }));
  app.use(requestIdMiddleware);
  app.useGlobalPipes(validationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}

import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './create-app';
import { loadDotEnv } from './load-dotenv';

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

// One Nest app per warm function instance. Built on the first request, reused after that.
let appPromise: Promise<INestApplication> | null = null;

function getApp(): Promise<INestApplication> {
  if (appPromise === null) {
    loadDotEnv();
    appPromise = createApp().catch((error: unknown) => {
      // Let the next invocation retry instead of caching a failed boot.
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

export async function getRequestListener(): Promise<RequestListener> {
  const app = await getApp();
  return app.getHttpAdapter().getInstance() as RequestListener;
}

/** Test-only: close the cached app so pools and timers do not outlive the test run. */
export async function closeCachedApp(): Promise<void> {
  const pending = appPromise;
  appPromise = null;
  if (pending) {
    await (await pending).close();
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let listener: RequestListener;
  try {
    listener = await getRequestListener();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to start';
    process.stderr.write(`${message}\n`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' }));
    return;
  }
  listener(req, res);
}

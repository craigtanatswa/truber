import { INestApplication } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import request from 'supertest';
import handler from '../api/index';
import { parseCorsOrigins } from '../src/config/env';
import { createApp } from '../src/create-app';
import { closeCachedApp } from '../src/serverless';
import { prepareTestDatabase } from './prepare-db';

const ALLOWED = 'https://truber-mobile-preview.vercel.app';
const OTHER = 'https://evil.example.com';

type Target = Parameters<typeof request>[0];

async function preflight(target: Target, origin: string) {
  return request(target)
    .options('/auth/me')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization');
}

async function simpleGet(target: Target, origin: string) {
  return request(target).get('/auth/me').set('Origin', origin);
}

async function withOrigins<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  if (value === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
}

async function bootDirect(origins: string | undefined): Promise<INestApplication> {
  return withOrigins(origins, () => createApp({ logger: false }));
}

async function bootServerless(origins: string | undefined): Promise<Server> {
  await closeCachedApp();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => void handler(req, res));
  // The serverless entry builds its app on the first request, so warm it while the env is set.
  await withOrigins(origins, async () => {
    await request(server).get('/does-not-exist');
  });
  return server;
}

describe('CORS', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  afterAll(async () => {
    await closeCachedApp();
  });

  describe.each([
    ['server (createApp)', 'direct'],
    ['serverless (api/index)', 'serverless'],
  ] as const)('%s', (_label, mode) => {
    async function boot(origins: string | undefined): Promise<{ target: Target; close: () => Promise<void> }> {
      if (mode === 'direct') {
        const app = await bootDirect(origins);
        return { target: app.getHttpServer(), close: () => app.close() };
      }
      const server = await bootServerless(origins);
      return { target: server, close: () => closeCachedApp() };
    }

    it('allows the configured origin on preflight and GET, without credentials', async () => {
      const { target, close } = await boot(`${ALLOWED}, https://other-allowed.example.com`);
      try {
        const pre = await preflight(target, ALLOWED);
        expect(pre.status).toBe(204);
        expect(pre.headers['access-control-allow-origin']).toBe(ALLOWED);
        expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
        expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

        const get = await simpleGet(target, ALLOWED);
        expect(get.status).toBe(401);
        expect(get.headers['access-control-allow-origin']).toBe(ALLOWED);
        expect(String(get.headers['access-control-expose-headers'])).toContain('X-Request-Id');
        expect(get.headers['access-control-allow-credentials']).toBeUndefined();
      } finally {
        await close();
      }
    });

    it('sends no CORS headers to another origin', async () => {
      const { target, close } = await boot(ALLOWED);
      try {
        const pre = await preflight(target, OTHER);
        expect(pre.headers['access-control-allow-origin']).toBeUndefined();
        const get = await simpleGet(target, OTHER);
        expect(get.status).toBe(401);
        expect(get.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await close();
      }
    });

    it('sends no CORS headers when CORS_ALLOWED_ORIGINS is unset', async () => {
      const { target, close } = await boot(undefined);
      try {
        const pre = await preflight(target, ALLOWED);
        expect(pre.headers['access-control-allow-origin']).toBeUndefined();
        const get = await simpleGet(target, ALLOWED);
        expect(get.status).toBe(401);
        expect(get.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await close();
      }
    });
  });

  it('accepts only exact https origins', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('  ')).toEqual([]);
    expect(parseCorsOrigins(`${ALLOWED},${ALLOWED}`)).toEqual([ALLOWED]);
    for (const bad of ['*', 'https://*.vercel.app', 'http://truber.example.com', 'https://truber.example.com/', 'https://truber.example.com/path', 'truber.example.com', 'null']) {
      expect(() => parseCorsOrigins(bad)).toThrow(/CORS_ALLOWED_ORIGINS/);
    }
  });
});

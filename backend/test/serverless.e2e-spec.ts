import { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'http';
import request from 'supertest';
import handler from '../api/index';
import { createApp } from '../src/create-app';
import { closeCachedApp } from '../src/serverless';
import { assertOperationResponse } from './contract';
import { truncate, uniqueEmail } from './helpers';
import { prepareTestDatabase } from './prepare-db';

interface CallOptions {
  token?: string;
  body?: unknown;
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  requestId: string | undefined;
}

type Call = (method: 'get' | 'post', url: string, options?: CallOptions) => Promise<CallResult>;

function makeCall(target: Parameters<typeof request>[0]): Call {
  return async (method, url, options) => {
    let call = request(target)[method](url);
    if (options?.token) call = call.set('Authorization', `Bearer ${options.token}`);
    if (options?.body !== undefined) call = call.send(options.body as object);
    const response = await call;
    return {
      status: response.status,
      body: response.body as Record<string, unknown>,
      requestId: response.headers['x-request-id'],
    };
  };
}

async function exercise(call: Call, email: string): Promise<Record<string, CallResult>> {
  const password = 'serverless-password';
  const notFound = await call('get', '/does-not-exist');
  const unauthorized = await call('get', '/auth/me');
  const invalid = await call('post', '/auth/register', {
    body: { email: 'not-an-email', password: 'short', fullName: '', role: 'shipper' },
  });
  const registered = await call('post', '/auth/register', {
    body: { email, password, fullName: 'Serverless User', role: 'shipper' },
  });
  const login = await call('post', '/auth/login', { body: { email, password } });
  const me = await call('get', '/auth/me', { token: login.body.accessToken as string });
  return { notFound, unauthorized, invalid, registered, login, me };
}

describe('serverless entry point', () => {
  let app: INestApplication;
  let server: Server;
  let directCall: Call;
  let serverlessCall: Call;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
    server = createServer(handler);
    directCall = makeCall(app.getHttpServer());
    serverlessCall = makeCall(server);
  });

  afterAll(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await closeCachedApp();
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
  });

  it('matches the direct app and carries request ids', async () => {
    const direct = await exercise(directCall, uniqueEmail('direct-entry'));
    const serverless = await exercise(serverlessCall, uniqueEmail('serverless-entry'));

    const expected = {
      notFound: 404,
      unauthorized: 401,
      invalid: 400,
      registered: 201,
      login: 200,
      me: 200,
    };
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(direct[key].status).toBe(expected[key]);
      expect(serverless[key].status).toBe(expected[key]);
      expect(serverless[key].status).toBe(direct[key].status);
    }

    for (const key of ['notFound', 'unauthorized', 'invalid'] as const) {
      expect(serverless[key].body.code).toBe(direct[key].body.code);
      expect(serverless[key].body.message).toBe(direct[key].body.message);
      expect(Object.keys(serverless[key].body).sort()).toEqual(Object.keys(direct[key].body).sort());
    }

    for (const key of ['registered', 'login', 'me'] as const) {
      expect(Object.keys(serverless[key].body).sort()).toEqual(Object.keys(direct[key].body).sort());
    }
    expect(serverless.me.body.id).toBe((serverless.registered.body.user as { id: string }).id);
    assertOperationResponse('getCurrentUser', 200, serverless.me.body);
    assertOperationResponse('getCurrentUser', 401, serverless.unauthorized.body);
    assertOperationResponse('login', 200, serverless.login.body);

    for (const key of Object.keys(serverless) as Array<keyof typeof serverless>) {
      expect(serverless[key].requestId).toBeTruthy();
    }
  });
});

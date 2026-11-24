import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CompanyResponse, TruckResponse } from '../src/domain';
import { assertOperationResponse } from './contract';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  HttpResult,
  http,
  latestPayload,
  uniqueEmail,
} from './helpers';

export interface Session {
  token: string;
  refreshToken: string;
  userId: string;
  email: string;
  password: string;
}

export type UserRole = 'shipper' | 'transporter';

export function expectContract(operationId: string, response: HttpResult, status: number): HttpResult {
  if (response.status !== status) {
    throw new Error(
      `${operationId} expected HTTP ${status} but got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  if (status >= 200 && status < 300) {
    assertOperationResponse(operationId, status, response.body);
  }
  return response;
}

export async function register(app: INestApplication, role: UserRole): Promise<Session> {
  const email = uniqueEmail(role);
  const password = `${role}-password`;
  const response = expectContract(
    'registerUser',
    await http(app, 'post', '/auth/register', {
      body: { email, password, fullName: `${role} user`, role },
    }),
    201,
  );
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    userId: response.body.user.id as string,
    email,
    password,
  };
}

export async function activate(app: INestApplication, session: Session): Promise<void> {
  expectContract(
    'requestRegistrationOtp',
    await http(app, 'post', '/auth/otp/request', {
      token: session.token,
      body: { channel: 'email' },
    }),
    202,
  );
  const code = await latestPayload(app, session.userId, 'otp');
  const verified = expectContract(
    'verifyRegistrationOtp',
    await http(app, 'post', '/auth/otp/verify', {
      token: session.token,
      body: { code },
    }),
    200,
  );
  if (verified.body.accountStatus !== 'active') {
    throw new Error(`OTP verification did not activate the account: ${JSON.stringify(verified.body)}`);
  }
}

export async function loginAdmin(app: INestApplication): Promise<Session> {
  const response = expectContract(
    'login',
    await http(app, 'post', '/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }),
    200,
  );
  return {
    token: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
    userId: response.body.user.id as string,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  };
}

export async function createCompany(
  app: INestApplication,
  token: string,
  type: UserRole,
  legalName: string,
): Promise<CompanyResponse> {
  const response = expectContract(
    'createCompany',
    await http(app, 'post', '/companies', {
      token,
      body: { type, legalName },
    }),
    201,
  );
  return response.body as CompanyResponse;
}

export async function createTruck(
  app: INestApplication,
  token: string,
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<TruckResponse> {
  const registrationNumber = `TRK${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const response = expectContract(
    'createTruck',
    await http(app, 'post', '/trucks', {
      token,
      body: {
        companyId,
        registrationNumber,
        truckType: 'flatbed',
        capacityKg: 10_000,
        ...overrides,
      },
    }),
    201,
  );
  return response.body as TruckResponse;
}

export function docUri(): string {
  return `https://files.truber.local/docs/${randomUUID()}.pdf`;
}

import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommissionGateService } from '../src/billing/commission-gate.service';
import { ReceivablesService } from '../src/billing/receivables.service';
import { ApiException } from '../src/common/api.exception';
import { createApp } from '../src/create-app';
import { DbService } from '../src/db/db.service';
import { truncate } from './helpers';
import { prepareTestDatabase } from './prepare-db';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('billing commission locking', () => {
  let app: INestApplication;
  let db: DbService;
  let receivables: ReceivablesService;
  let gate: CommissionGateService;
  let companyId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    await prepareTestDatabase();
    app = await createApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncate();
    db = app.get(DbService);
    receivables = app.get(ReceivablesService);
    gate = app.get(CommissionGateService);
    companyId = await insertCompany(db);
    otherCompanyId = await insertCompany(db);
  });

  function recognise(client: Parameters<ReceivablesService['recognise']>[0], company: string, amountMinor: number) {
    return receivables.recognise(client, {
      bookingId: randomUUID(),
      transporterCompanyId: company,
      tripAmount: { amountMinor, currency: 'USD' },
      paymentMethod: 'prepay',
    });
  }

  async function captureGateError(company = companyId): Promise<ApiException> {
    try {
      await db.tx((client) => gate.assertCanTakeNewWork(client, company));
    } catch (error) {
      if (error instanceof ApiException) {
        return error;
      }
      throw error;
    }
    throw new Error('Expected an ApiException');
  }

  it('holds the gate until an in-flight recognition commits, then rejects', async () => {
    const recognised = deferred();
    const releaseA = deferred();
    const txA = db.tx(async (clientA) => {
      await recognise(clientA, companyId, 100000);
      recognised.resolve();
      await releaseA.promise;
    });
    await recognised.promise;

    let settled = false;
    let outcome: unknown;
    const txB = db.tx(async (clientB) => {
      try {
        await gate.assertCanTakeNewWork(clientB, companyId);
        outcome = 'passed';
      } catch (error) {
        outcome = error;
      } finally {
        settled = true;
      }
    });

    let pendingError: unknown;
    try {
      await delay(300);
      expect(settled).toBe(false);
    } catch (error) {
      pendingError = error;
    } finally {
      releaseA.resolve();
    }
    await Promise.all([txA, txB]);
    if (pendingError) {
      throw pendingError;
    }

    expect(outcome).toBeInstanceOf(ApiException);
    const error = outcome as ApiException;
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('COMMISSION_OUTSTANDING');
    expect(error.details).toEqual({
      outstandingAmount: { amountMinor: 5000, currency: 'USD' },
      outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
    });
  });

  it('makes recognition wait for an open gate transaction and then succeed', async () => {
    const gatePassed = deferred();
    const releaseB = deferred();
    const txB = db.tx(async (clientB) => {
      await gate.assertCanTakeNewWork(clientB, companyId);
      gatePassed.resolve();
      await releaseB.promise;
    });
    await gatePassed.promise;

    let settled = false;
    const txA = db.tx(async (clientA) => {
      try {
        await recognise(clientA, companyId, 100000);
      } finally {
        settled = true;
      }
    });

    let pendingError: unknown;
    try {
      await delay(300);
      expect(settled).toBe(false);
    } catch (error) {
      pendingError = error;
    } finally {
      releaseB.resolve();
    }
    await Promise.all([txB, txA]);
    if (pendingError) {
      throw pendingError;
    }

    const error = await captureGateError();
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('COMMISSION_OUTSTANDING');
    expect(error.details).toEqual({
      outstandingAmount: { amountMinor: 5000, currency: 'USD' },
      outstandingByCurrency: [{ amountMinor: 5000, currency: 'USD' }],
    });
  });

  it('lets two gates on the same company hold shared locks together', async () => {
    const entered = [deferred(), deferred()];
    const release = deferred();
    const txs = entered.map((enteredTx, index) =>
      db.tx(async (client) => {
        await gate.assertCanTakeNewWork(client, companyId);
        enteredTx.resolve();
        await release.promise;
        return index;
      }),
    );

    let blockedError: unknown;
    try {
      await Promise.race([
        Promise.all(entered.map((enteredTx) => enteredTx.promise)),
        delay(500).then(() => {
          throw new Error('the second shared gate waited for the first');
        }),
      ]);
    } catch (error) {
      blockedError = error;
    } finally {
      release.resolve();
    }
    await Promise.all(txs);
    if (blockedError) {
      throw blockedError;
    }
  });

  it('does not block a gate on another company while a recognition is in flight', async () => {
    const recognised = deferred();
    const release = deferred();
    const txA = db.tx(async (client) => {
      await recognise(client, companyId, 100000);
      recognised.resolve();
      await release.promise;
    });
    await recognised.promise;

    let blockedError: unknown;
    try {
      await Promise.race([
        db.tx((client) => gate.assertCanTakeNewWork(client, otherCompanyId)),
        delay(500).then(() => {
          throw new Error('the gate for another company waited');
        }),
      ]);
    } catch (error) {
      blockedError = error;
    } finally {
      release.resolve();
    }
    await txA;
    if (blockedError) {
      throw blockedError;
    }
  });
});

async function insertCompany(db: DbService): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO companies (id, type, legal_name, verification_status, created_at, updated_at)
     VALUES ($1, 'transporter', 'Billing Carrier', 'verified', now(), now())`,
    [id],
  );
  return id;
}

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ENV, Env } from '../config/env';
import { qualifyAppSql } from './identifiers';
import { buildPoolConfig } from './pg-config';
import { assertReady } from './readiness';

export interface DbQuery {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy, DbQuery {
  readonly pool: Pool;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.pool = new Pool(buildPoolConfig(env.db, 'runtime'));
  }

  async onModuleInit(): Promise<void> {
    await assertReady(this.pool, this.env.db);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (this.transactionMode) {
      return this.tx((client) => client.query<T>(text, params));
    }
    return this.pool.query<T>(this.qualify(text), params);
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const qualified = this.qualifyClient(client);
    try {
      if (this.transactionMode) {
        await client.query(
          `BEGIN; SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = ${Number(this.env.db.DB_STATEMENT_TIMEOUT_MS)}`,
        );
      } else {
        await qualified.query('BEGIN');
      }
      const result = await fn(qualified);
      await qualified.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await qualified.query('ROLLBACK');
      } catch {
        // The original error is the one callers must see.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private get transactionMode(): boolean {
    return this.env.db.DB_CONNECTION_MODE === 'transaction';
  }

  private qualify(text: string): string {
    return qualifyAppSql(text, { appSchema: this.env.db.DB_SCHEMA, postgisSchema: this.env.db.POSTGIS_SCHEMA });
  }

  private qualifyClient(client: PoolClient): PoolClient {
    const original = client.query.bind(client) as (queryText: string, values?: unknown[]) => Promise<QueryResult>;
    const qualify = this.qualify.bind(this);
    const wrapped = ((queryText: string, values?: unknown[]) => original(qualify(queryText), values)) as PoolClient['query'];
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property === 'query') return wrapped;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

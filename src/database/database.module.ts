import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { TIMEOUTS } from '../config/limits'
import * as schema from './schema'

/** Injection token for the Drizzle database (`Database`). */
export const DATABASE = Symbol('DATABASE')
export type Database = NodePgDatabase<typeof schema>

/**
 * The database or a transaction on it. A function that may run inside a caller's transaction
 * (writes that must agree) takes this and defaults to the database.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>

const PG_POOL = Symbol('PG_POOL')

/** One Postgres pool per process, closed on shutdown. Postgres is the only source of truth. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        // a connection that can't be made fails fast, so /api/health answers 503 instead of hanging
        new Pool({
          connectionString: env.DATABASE_URL,
          connectionTimeoutMillis: TIMEOUTS.databaseConnectMs,
        }),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool, schema, casing: 'snake_case' }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end()
  }
}

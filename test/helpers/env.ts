import { type Env, parseEnv } from '../../src/config/env.schema'

/**
 * Where the e2e tests find Postgres and Redis: `DATABASE_URL` / `REDIS_URL` from the shell when
 * the compose ports were changed (e.g. `POSTGRES_PORT=55432`), otherwise compose.yaml's defaults.
 * The database name is always replaced by `cv_test`, so a test run never touches `cv`.
 */
export const TEST_DATABASE = 'cv_test'

/** BullMQ keys of the tests, kept apart from a `pnpm dev` worker on the same Redis. */
export const TEST_QUEUE_PREFIX = 'cv_test'

/** The URL the tests connect to for creating `cv_test`: compose's own `cv` database. */
export const adminDatabaseUrl = (): string =>
  process.env.DATABASE_URL ?? 'postgres://cv:cv@127.0.0.1:5432/cv'

export const testDatabaseUrl = (): string => {
  const url = new URL(adminDatabaseUrl())
  url.pathname = `/${TEST_DATABASE}`
  return url.toString()
}

export const testEnv = (): Env =>
  parseEnv({
    DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    QUEUE_PREFIX: TEST_QUEUE_PREFIX,
    ANTHROPIC_API_KEY: 'test-key-never-used',
    WORKER_CONCURRENCY: '1',
    LOG_LEVEL: 'silent',
  })

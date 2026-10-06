import {
  type Env,
  LOCAL_DATABASE_URL,
  LOCAL_REDIS_URL,
  parseEnv,
} from '../../src/config/env.schema'
import {
  GENERATION_TIMING_DEFAULTS,
  type GenerationTiming,
} from '../../src/generation/generation.queue'

/**
 * Where the e2e tests find Postgres and Redis: the project's own compose services on their host
 * ports, or `DATABASE_URL` / `REDIS_URL` from the shell when those ports were changed. The
 * database name is always replaced by `cv_test`, so a test run never touches `cv`.
 */
export const TEST_DATABASE = 'cv_test'

/** BullMQ keys of the tests, kept apart from a `pnpm dev` worker on the same Redis. */
export const TEST_QUEUE_PREFIX = 'cv_test'

/** The URL the tests connect to for creating `cv_test`: compose's own `cv` database. */
export const adminDatabaseUrl = (): string => process.env.DATABASE_URL ?? LOCAL_DATABASE_URL

export const testDatabaseUrl = (): string => {
  const url = new URL(adminDatabaseUrl())
  url.pathname = `/${TEST_DATABASE}`
  return url.toString()
}

export const testEnv = (): Env =>
  parseEnv({
    DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: process.env.REDIS_URL ?? LOCAL_REDIS_URL,
    QUEUE_PREFIX: TEST_QUEUE_PREFIX,
    ANTHROPIC_API_KEY: 'test-key-never-used',
    WORKER_CONCURRENCY: '1',
    LOG_LEVEL: 'silent',
  })

/**
 * The waits of a generation in the e2e tests: a backoff long enough to see `retrying` by polling
 * and short enough to run three attempts in about a second; the rest as in production.
 */
export const TEST_TIMING: GenerationTiming = { ...GENERATION_TIMING_DEFAULTS, backoffMs: 300 }

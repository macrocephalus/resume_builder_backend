import IORedis from 'ioredis'
import { Pool } from 'pg'
import { runMigrations } from '../src/database/migrate'
import {
  TEST_DATABASE,
  TEST_QUEUE_PREFIX,
  adminDatabaseUrl,
  testDatabaseUrl,
  testEnv,
} from './helpers/env'

const START_HINT =
  "The e2e tests need the project's own Postgres and Redis from compose: " +
  '`docker compose up postgres redis` in backend/ (or `pnpm stack:backend` from the root). ' +
  'If you changed POSTGRES_PORT / REDIS_PORT, run the tests with the matching DATABASE_URL / REDIS_URL.'

/** The URL without its password, for messages. */
const redacted = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.password) parsed.password = '***'
  return parsed.toString()
}

const unusable = (service: string, url: string, cause: unknown): Error => {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new Error(`Cannot use ${service} at ${redacted(url)}: ${reason}. ${START_HINT}`)
}

const ensureTestDatabase = async (): Promise<void> => {
  const admin = new Pool({ connectionString: adminDatabaseUrl(), max: 1 })
  try {
    const existing = await admin
      .query('select 1 from pg_database where datname = $1', [TEST_DATABASE])
      .catch((cause: unknown) => {
        throw unusable('Postgres', adminDatabaseUrl(), cause)
      })
    if (existing.rowCount === 0) await admin.query(`create database "${TEST_DATABASE}"`)
  } finally {
    await admin.end()
  }
}

const ensureRedisAndClearQueue = async (): Promise<void> => {
  const env = testEnv()
  const redis = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  redis.on('error', () => undefined) // reported once below, not as an unhandled event
  try {
    await redis.connect().catch((cause: unknown) => {
      throw unusable('Redis', env.REDIS_URL, cause)
    })
    const keys = await redis.keys(`${TEST_QUEUE_PREFIX}:*`)
    if (keys.length > 0) await redis.del(...keys)
  } finally {
    redis.disconnect()
  }
}

/** Once per `pnpm test:e2e` run: the `cv_test` database exists and is migrated, the queue is empty. */
export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase()
  await runMigrations(testDatabaseUrl())
  await ensureRedisAndClearQueue()
}

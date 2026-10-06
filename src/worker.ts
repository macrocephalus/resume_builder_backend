import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { NestFactory } from '@nestjs/core'
import type { Redis } from 'ioredis'
import { Logger } from 'nestjs-pino'
import { parseEnv } from './config/env.schema'
import { REDIS } from './redis/redis.module'
import { run } from './run'
import { WorkerModule } from './worker.module'

const REDIS_START_TIMEOUT_MS = 10_000

/** The shared connection retries forever; at start we want to fail instead, so compose restarts us. */
const pingWithin = async (redis: Redis, ms: number): Promise<void> => {
  const timeout = new AbortController()
  const failed = sleep(ms, undefined, { signal: timeout.signal }).then(() => {
    throw new Error(`Redis did not answer within ${ms} ms`)
  })
  try {
    await Promise.race([redis.ping(), failed])
  } finally {
    timeout.abort()
  }
}

// The worker: an application context without HTTP. It starts after the api is healthy, so the
// migrations are already applied; SIGTERM closes the Redis connection and the Postgres pool.
run(async () => {
  const env = parseEnv(process.env)
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  })
  const logger = app.get(Logger)
  app.useLogger(logger)
  app.enableShutdownHooks()
  try {
    await pingWithin(app.get<Redis>(REDIS), REDIS_START_TIMEOUT_MS)
  } catch (error) {
    await app.close()
    throw error
  }
  logger.log(`worker ready, concurrency ${env.WORKER_CONCURRENCY}`, 'Bootstrap')
})

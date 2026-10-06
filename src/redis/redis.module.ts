import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import IORedis, { type Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'

/** Injection token for the ioredis client (`Redis`) that BullMQ shares. */
export const REDIS = Symbol('REDIS')

/**
 * One Redis connection per process, closed on shutdown. Redis holds only the queue; losing it
 * loses no data (the worker re-enqueues from Postgres). `maxRetriesPerRequest: null` is what
 * BullMQ requires of a shared connection: commands wait for a reconnect instead of failing, so
 * anything that must not wait forever (the start-up ping, the shutdown) bounds itself.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV, PinoLogger],
      useFactory: (env: Env, logger: PinoLogger): Redis => {
        logger.setContext(RedisModule.name)
        const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
        redis.on('error', (err: Error) => logger.error({ err }, 'redis connection error'))
        return redis
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** A clean QUIT when connected; otherwise drop the socket — a queued QUIT would never return. */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit().catch(() => undefined)
    else this.redis.disconnect()
  }
}

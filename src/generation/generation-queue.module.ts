import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { REDIS } from '../redis/redis.module'
import { GenerationProducer } from './generation.producer'
import {
  GENERATION_JOB_OPTIONS,
  GENERATION_QUEUE,
  GENERATION_QUEUE_NAME,
  type GenerationJobData,
} from './generation.queue'

/**
 * The generation queue and its producer: the lower half of `generation/`, which `cvs` uses to
 * start a generation. The processor (worker) sits above `cvs` in its own module, so the module
 * graph has no cycle.
 */
@Module({
  providers: [
    {
      provide: GENERATION_QUEUE,
      inject: [REDIS, ENV, PinoLogger],
      useFactory: (redis: Redis, env: Env, logger: PinoLogger) => {
        logger.setContext(GenerationQueueModule.name)
        const queue = new Queue<GenerationJobData>(GENERATION_QUEUE_NAME, {
          connection: redis,
          prefix: env.QUEUE_PREFIX,
          defaultJobOptions: GENERATION_JOB_OPTIONS,
        })
        // without a listener BullMQ prints connection errors with console.error, past pino
        queue.on('error', (err: Error) => logger.error({ err }, 'generation queue error'))
        return queue
      },
    },
    GenerationProducer,
  ],
  exports: [GenerationProducer],
})
export class GenerationQueueModule implements OnApplicationShutdown {
  constructor(@Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>) {}

  /** The shared Redis connection stays open: `RedisModule` closes it. */
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close()
  }
}

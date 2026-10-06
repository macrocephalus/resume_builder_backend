import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { REDIS } from '../redis/redis.module'
import { GenerationProducer } from './generation.producer'
import {
  GENERATION_QUEUE,
  GENERATION_QUEUE_NAME,
  GENERATION_TIMING,
  GENERATION_TIMING_DEFAULTS,
  type GenerationJobData,
  type GenerationTiming,
  generationJobOptions,
} from './generation.queue'

/**
 * The generation queue, its producer and the waits of a generation: the lower half of
 * `generation/`, which `cvs` uses to start a generation. The processor (worker) sits above `cvs`
 * in its own module, so the module graph has no cycle.
 */
@Module({
  providers: [
    { provide: GENERATION_TIMING, useValue: GENERATION_TIMING_DEFAULTS },
    {
      provide: GENERATION_QUEUE,
      inject: [REDIS, ENV, GENERATION_TIMING, PinoLogger],
      useFactory: (redis: Redis, env: Env, timing: GenerationTiming, logger: PinoLogger) => {
        logger.setContext(GenerationQueueModule.name)
        const queue = new Queue<GenerationJobData>(GENERATION_QUEUE_NAME, {
          connection: redis,
          prefix: env.QUEUE_PREFIX,
          defaultJobOptions: generationJobOptions(timing),
        })
        // without a listener BullMQ prints connection errors with console.error, past pino
        queue.on('error', (err: Error) => logger.error({ err }, 'generation queue error'))
        return queue
      },
    },
    GenerationProducer,
  ],
  // the worker's processor and recovery use the producer and the waits too
  exports: [GenerationProducer, GENERATION_TIMING],
})
export class GenerationQueueModule implements OnApplicationShutdown {
  constructor(@Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>) {}

  /** The shared Redis connection stays open: `RedisModule` closes it. */
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close()
  }
}

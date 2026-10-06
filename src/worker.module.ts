import { type DynamicModule, Module } from '@nestjs/common'
import { AppLoggerModule } from './common/logging/logger.module'
import { ConfigModule } from './config/config.module'
import type { Env } from './config/env.schema'
import { DatabaseModule } from './database/database.module'
import { GenerationModule } from './generation/generation.module'
import { RedisModule } from './redis/redis.module'

/**
 * The worker process: no HTTP. Config, logger, database, the Redis connection, the generation
 * processor and the queue recovery.
 */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(env),
        AppLoggerModule,
        DatabaseModule,
        RedisModule,
        GenerationModule,
      ],
    }
  }
}

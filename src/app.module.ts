import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module'
import { AppExceptionFilter } from './common/http/error.filter'
import { AppLoggerModule } from './common/logging/logger.module'
import { ConfigModule } from './config/config.module'
import type { Env } from './config/env.schema'
import { THROTTLES } from './config/limits'
import { CvsModule } from './cvs/cvs.module'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'
import { IngestModule } from './ingest/ingest.module'
import { RedisModule } from './redis/redis.module'

/** Everything HTTP. `main.ts` and the e2e tests build it with their own parsed `Env`. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        AppLoggerModule,
        DatabaseModule,
        RedisModule,
        // in memory, for one api instance. Only routes marked @RateLimit are counted, each with
        // its own numbers; this entry only declares the `default` throttler they override.
        ThrottlerModule.forRoot([{ ttl: THROTTLES.login.ttlMs, limit: THROTTLES.login.limit }]),
        HealthModule,
        AuthModule,
        IngestModule,
        CvsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
    }
  }
}

import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { AppExceptionFilter } from './common/http/error.filter'
import { AppLoggerModule } from './common/logging/logger.module'
import { ConfigModule } from './config/config.module'
import type { Env } from './config/env.schema'
import { DatabaseModule } from './database/database.module'
import { HealthModule } from './health/health.module'

/** Everything HTTP. `main.ts` and the e2e tests build it with their own parsed `Env`. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), AppLoggerModule, DatabaseModule, HealthModule],
      providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
    }
  }
}

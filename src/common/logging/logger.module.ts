import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { ENV } from '../../config/config.module'
import type { Env } from '../../config/env.schema'
import { pinoHttpOptions } from './logger-options'

/** pino as the Nest logger of both processes, configured by `pinoHttpOptions`. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // fields added during a request (the user id from the auth guard) reach its response line
        assignResponse: true,
        pinoHttp: pinoHttpOptions(env),
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}

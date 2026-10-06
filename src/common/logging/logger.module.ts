import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LoggerModule } from 'nestjs-pino'
import { ENV } from '../../config/config.module'
import type { Env } from '../../config/env.schema'

const REQUEST_ID_HEADER = 'x-request-id'

const requestId = (req: IncomingMessage, res: ServerResponse): string => {
  const sent = req.headers[REQUEST_ID_HEADER]
  const id = typeof sent === 'string' && sent.length > 0 && sent.length <= 128 ? sent : randomUUID()
  res.setHeader(REQUEST_ID_HEADER, id)
  return id
}

/**
 * pino to stdout as JSON, in both processes. Every request line carries the request id; the
 * cookie and authorization headers are redacted. The docker healthcheck's `GET /api/health` is
 * not logged per request.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: requestId,
          redact: {
            paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
            censor: '[redacted]',
          },
          autoLogging: {
            ignore: (req) => req.url === '/api/health',
          },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}

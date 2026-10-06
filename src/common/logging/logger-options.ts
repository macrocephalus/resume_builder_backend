import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Options } from 'pino-http'
import type { Env } from '../../config/env.schema'

const REQUEST_ID_HEADER = 'x-request-id'
/** A client-sent id longer than this is replaced, so a log line cannot be flooded through it. */
const MAX_REQUEST_ID_LENGTH = 128

/**
 * The key of a log line that holds what the user wrote or the model answered (a CV's source,
 * answers, the prompt, a submission). Redacted unless `LOG_CONTENT` is on (backend architecture
 * §6a); put nothing else in it and nothing of the kind anywhere else.
 */
export const CONTENT = 'content'

/**
 * The `res.locals` key the error filter puts the code it answered with under, for the request's
 * line; a body the parser refused is answered before any request context exists.
 */
export const ANSWERED_ERROR_CODE = 'errorCode'

const ALWAYS_REDACTED = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
]

const requestId = (req: IncomingMessage, res: ServerResponse): string => {
  const sent = req.headers[REQUEST_ID_HEADER]
  const id =
    typeof sent === 'string' && sent.length > 0 && sent.length <= MAX_REQUEST_ID_LENGTH
      ? sent
      : randomUUID()
  res.setHeader(REQUEST_ID_HEADER, id)
  return id
}

const answeredErrorCode = (res: ServerResponse): Record<string, string> => {
  if (!('locals' in res) || typeof res.locals !== 'object' || res.locals === null) return {}
  if (!(ANSWERED_ERROR_CODE in res.locals)) return {}
  const code = res.locals[ANSWERED_ERROR_CODE]
  return typeof code === 'string' ? { [ANSWERED_ERROR_CODE]: code } : {}
}

/**
 * pino for both processes: JSON to stdout, or pino-pretty (a dev dependency) with `LOG_PRETTY`.
 * Every request line carries the request id and is logged by its outcome (with the error code
 * answered); a line logged during
 * the request carries only the id (and the user id the auth guard assigns); the cookie and
 * authorization headers are always redacted, the `content` of a line unless `LOG_CONTENT` is on.
 * The docker healthcheck's `GET /api/health` is not logged per request.
 */
export const pinoHttpOptions = (
  env: Pick<Env, 'LOG_LEVEL' | 'LOG_CONTENT' | 'LOG_PRETTY'>,
): Options => ({
  level: env.LOG_LEVEL,
  genReqId: requestId,
  // a line logged during a request carries the request id; the request is on its response line
  quietReqLogger: true,
  redact: {
    paths: env.LOG_CONTENT ? ALWAYS_REDACTED : [...ALWAYS_REDACTED, CONTENT],
    censor: '[redacted]',
  },
  customProps: (_req, res) => answeredErrorCode(res),
  customLogLevel: (_req, res, err) => {
    if (err !== undefined || res.statusCode >= 500) return 'error'
    return res.statusCode >= 400 ? 'warn' : 'info'
  },
  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },
  ...(env.LOG_PRETTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,context',
            messageFormat: '{if context}[{context}] {end}{msg}',
          },
        },
      }
    : {}),
})

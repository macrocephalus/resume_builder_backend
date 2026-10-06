import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'
import type { ErrorCode, ErrorResponse } from '@cv/shared'
import type { Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../errors/app-error'
import { safeError } from '../logging/safe-error'

type ErrorReply = { status: number; body: ErrorResponse; headers?: Record<string, string> }

/** Codes for the errors Nest raises itself (unknown route, guard, throttler, …). */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  413: 'INPUT_TOO_LARGE',
  429: 'RATE_LIMITED',
}

const reply = (status: number, code: ErrorCode, message: string, details = {}): ErrorReply => ({
  status,
  body: { error: { code, message, details } },
})

const INTERNAL = reply(500, 'INTERNAL', 'Something went wrong on our side. Please try again.')
const BAD_BODY = reply(400, 'VALIDATION_ERROR', 'The request is invalid.')
const TOO_LARGE = reply(413, 'INPUT_TOO_LARGE', 'The request body is too large.')

/**
 * Errors from Express middleware (the body parser, via `http-errors`): they carry `expose: true`
 * and a 4xx status. Nothing else with a `status` field (an SDK error, say) is trusted this way.
 */
const expressClientError = (exception: unknown): number | null => {
  if (typeof exception !== 'object' || exception === null) return null
  // read two optional fields of an unknown object; both are checked before they are trusted
  const { expose, status } = exception as { expose?: unknown; status?: unknown }
  return expose === true && typeof status === 'number' && status >= 400 && status < 500
    ? status
    : null
}

export const toReply = (exception: unknown): ErrorReply | null => {
  if (exception instanceof AppError) {
    return {
      ...reply(exception.status, exception.code, exception.message, exception.details),
      headers: exception.headers,
    }
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus()
    const code = CODE_BY_STATUS[status]
    return code ? reply(status, code, exception.message) : null
  }
  const status = expressClientError(exception)
  if (status === null) return null
  return status === 413 ? TOO_LARGE : BAD_BODY
}

/** The one place every error becomes `{ error: { code, message, details } }`. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AppExceptionFilter.name)
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const known = toReply(exception)
    // a failed query would otherwise log its parameters (a CV's text) with the error
    if (!known) this.logger.error({ err: safeError(exception) }, 'unhandled error')
    // a 500 answered on purpose (DATA_CORRUPT) is still a fault on our side
    else if (known.status === 500) this.logger.error({ err: exception }, known.body.error.code)
    const { status, body, headers = {} } = known ?? INTERNAL
    response.set(headers).status(status).json(body)
  }
}

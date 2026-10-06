import { DrizzleQueryError } from 'drizzle-orm'

/** What of an error may be logged or stored: never the data it was thrown over. */
export type SafeError = {
  name: string
  message: string
  statusCode?: number
  code?: string
  stack?: string
}

/**
 * AI SDK errors whose message only describes the failure. The others (`TypeValidationError`,
 * `InvalidToolInputError`, …) quote the value they failed on: the model's draft, built from the
 * user's source.
 */
const AI_ERRORS_WITHOUT_DATA = new Set(['AI_APICallError', 'AI_RetryError', 'AI_LoadAPIKeyError'])

/** The call frames only: the first line of a stack repeats the message. */
const framesOf = (stack: string | undefined): string | undefined =>
  stack
    ?.split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n') || undefined

const messageOf = (error: Error): string => {
  // its message holds the SQL and its parameters (a CV, a password hash); the cause is Postgres's
  if (error instanceof DrizzleQueryError) return error.cause?.message ?? 'database query failed'
  if (error.name.startsWith('AI_') && !AI_ERRORS_WITHOUT_DATA.has(error.name)) {
    return '(message omitted: it may quote user data)'
  }
  return error.message
}

/**
 * An error as logs and `generation_attempts.error` may carry it. pino's own serializer copies
 * every enumerable field, and the AI SDK's `APICallError` keeps the whole request (the source
 * text) in one of them; so errors that may carry user data are logged through this.
 */
export const safeError = (error: unknown): SafeError => {
  if (!(error instanceof Error)) return { name: 'NonError', message: `${typeof error} thrown` }
  const cause = error instanceof DrizzleQueryError ? error.cause : undefined
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
  const withCode = cause ?? error
  const code = 'code' in withCode && typeof withCode.code === 'string' ? withCode.code : undefined
  const stack = framesOf(error.stack)
  return {
    // some libraries leave `name` as "Error" (DrizzleQueryError); the class says more
    name: error.name === 'Error' ? error.constructor.name : error.name,
    message: messageOf(error),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(code === undefined ? {} : { code }),
    ...(stack === undefined ? {} : { stack }),
  }
}

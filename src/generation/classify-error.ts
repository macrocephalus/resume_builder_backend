import { APICallError, RetryError } from 'ai'
import type { GenerationErrorCode } from './generation-errors'

/** What a failed attempt means for its CV (backend architecture §5). */
export type Classified = { code: GenerationErrorCode; retryable: boolean }

/** An attempt whose agent ended without one schema-valid `submit_draft`. */
export class NoValidSubmissionError extends Error {
  override readonly name = 'NoValidSubmissionError'

  constructor(steps: number) {
    super(`no schema-valid submit_draft in ${steps} agent steps`)
  }
}

const INTERNAL: Classified = { code: 'INTERNAL', retryable: false }

/** The SDK's step and total timeouts abort with a `TimeoutError` `DOMException`. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError'

/**
 * Maps an error of one attempt to the CV's error code and whether BullMQ may run the attempt
 * again. Pure: the processor decides what to write from the result.
 */
export const classifyError = (error: unknown): Classified => {
  if (error instanceof NoValidSubmissionError)
    return { code: 'LLM_INVALID_OUTPUT', retryable: true }
  if (isTimeout(error)) return { code: 'TIMEOUT', retryable: true }
  // the SDK retried the call itself; its last error says why it gave up
  if (RetryError.isInstance(error)) return classifyError(error.lastError)
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return { code: 'LLM_CONFIG', retryable: false }
    }
    if (error.isRetryable) return { code: 'LLM_UNAVAILABLE', retryable: true }
  }
  return INTERNAL
}

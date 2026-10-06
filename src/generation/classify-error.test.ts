import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'
import { NoValidSubmissionError, classifyError } from './classify-error'

const apiError = (statusCode: number | undefined, isRetryable?: boolean) =>
  new APICallError({
    message: `status ${statusCode}`,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    ...(isRetryable === undefined ? {} : { isRetryable }),
  })

const retryError = (reason: 'maxRetriesExceeded' | 'errorNotRetryable', errors: unknown[]) =>
  new RetryError({ message: 'Failed after retries', reason, errors })

describe('classifyError', () => {
  it.each([408, 409, 429, 500, 503, 529])(
    'a %i from the API is LLM_UNAVAILABLE, retryable',
    (status) => {
      expect(classifyError(apiError(status))).toEqual({ code: 'LLM_UNAVAILABLE', retryable: true })
    },
  )

  it('a network failure (retryable, no status) is LLM_UNAVAILABLE, retryable', () => {
    expect(classifyError(apiError(undefined, true))).toEqual({
      code: 'LLM_UNAVAILABLE',
      retryable: true,
    })
  })

  it.each([401, 403])('a %i (bad key) is LLM_CONFIG, not retryable', (status) => {
    expect(classifyError(apiError(status))).toEqual({ code: 'LLM_CONFIG', retryable: false })
  })

  it.each([400, 404, 413])('another %i is INTERNAL, not retryable', (status) => {
    expect(classifyError(apiError(status))).toEqual({ code: 'INTERNAL', retryable: false })
  })

  it('the SDK giving up after its retries is classified by the last error', () => {
    const overloaded = retryError('maxRetriesExceeded', [
      apiError(529),
      apiError(529),
      apiError(529),
    ])
    expect(classifyError(overloaded)).toEqual({ code: 'LLM_UNAVAILABLE', retryable: true })
    const keyRevoked = retryError('errorNotRetryable', [apiError(529), apiError(401)])
    expect(classifyError(keyRevoked)).toEqual({ code: 'LLM_CONFIG', retryable: false })
  })

  it('a step or attempt over its time is TIMEOUT, retryable', () => {
    const timeout = new DOMException('Step timeout of 120000ms exceeded', 'TimeoutError')
    expect(classifyError(timeout)).toEqual({ code: 'TIMEOUT', retryable: true })
  })

  it('no schema-valid submission is LLM_INVALID_OUTPUT, retryable', () => {
    expect(classifyError(new NoValidSubmissionError(3))).toEqual({
      code: 'LLM_INVALID_OUTPUT',
      retryable: true,
    })
  })

  it.each([
    ['an unexpected error', new TypeError('x is undefined')],
    ['an abort that is not a timeout', new DOMException('aborted', 'AbortError')],
    ['a thrown non-error', 'boom'],
  ])('%s is INTERNAL, not retryable', (_, error) => {
    expect(classifyError(error)).toEqual({ code: 'INTERNAL', retryable: false })
  })
})

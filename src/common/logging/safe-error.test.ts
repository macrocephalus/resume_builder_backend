import { APICallError } from 'ai'
import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { safeError } from './safe-error'

const SECRET = 'Olena Hnatiuk, +380 67 123 45 67'

describe('safeError', () => {
  it("keeps an AI SDK error's name, message and status, never the request it carried", () => {
    const error = new APICallError({
      message: 'invalid x-api-key',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: { messages: [{ role: 'user', content: SECRET }] },
      statusCode: 401,
      responseBody: '{"error":"invalid x-api-key"}',
      isRetryable: false,
    })
    const safe = safeError(error)
    expect(safe).toMatchObject({
      name: 'AI_APICallError',
      message: 'invalid x-api-key',
      statusCode: 401,
    })
    expect(JSON.stringify(safe)).not.toContain('Olena')
  })

  it("keeps a failed query's database error, never its SQL parameters", () => {
    const cause = Object.assign(new Error('insert or update violates foreign key constraint'), {
      code: '23503',
    })
    const error = new DrizzleQueryError('insert into "cvs" values ($1)', [SECRET], cause)
    const safe = safeError(error)
    expect(safe).toMatchObject({
      name: 'DrizzleQueryError',
      message: 'insert or update violates foreign key constraint',
      code: '23503',
    })
    expect(JSON.stringify(safe)).not.toContain('Olena')
  })

  it('keeps the stack frames but not the first line, which repeats the message', () => {
    const safe = safeError(new DrizzleQueryError('select', [SECRET], new Error('boom')))
    expect(safe.stack).toMatch(/^\s+at /)
    expect(safe.stack).not.toContain('Olena')
  })

  it('describes anything thrown, not only errors', () => {
    expect(safeError('a string')).toEqual({ name: 'NonError', message: 'string thrown' })
  })
})

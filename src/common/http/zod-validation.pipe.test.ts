import { credentialsSchema } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../errors/app-error'
import { ZodValidationPipe } from './zod-validation.pipe'

const pipe = new ZodValidationPipe(credentialsSchema)

const caught = (run: () => unknown): AppError => {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the pipe to throw')
}

describe('ZodValidationPipe', () => {
  it('returns the parsed value, with unknown keys stripped', () => {
    const parsed = pipe.transform({ email: 'a@b.co', password: 'longenough', userId: 'x' })
    expect(parsed).toEqual({ email: 'a@b.co', password: 'longenough' })
  })

  it('answers 400 VALIDATION_ERROR with the first message per field', () => {
    const error = caught(() => pipe.transform({ email: 'nope' }))
    expect(error.status).toBe(400)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(error.details.fields as object).sort()).toEqual(['email', 'password'])
    expect((error.details.fields as Record<string, string>).email).toEqual(expect.any(String))
  })

  it('names a nested field by its dotted path and the whole body as "body"', () => {
    const nested = new ZodValidationPipe(z.object({ data: z.object({ title: z.string() }) }))
    expect(caught(() => nested.transform({ data: {} })).details.fields).toEqual({
      'data.title': expect.any(String),
    })
    expect(caught(() => nested.transform(undefined)).details.fields).toEqual({
      body: expect.any(String),
    })
  })
})

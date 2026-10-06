import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AppError } from '../errors/app-error'
import { toReply } from './error.filter'

describe('toReply', () => {
  it('passes an AppError through as it is', () => {
    expect(
      toReply(new AppError(409, 'VERSION_CONFLICT', 'Changed elsewhere.', { currentVersion: 4 })),
    ).toEqual({
      status: 409,
      body: {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Changed elsewhere.',
          details: { currentVersion: 4 },
        },
      },
      headers: {},
    })
  })

  it('carries the headers of an AppError, such as Retry-After', () => {
    const error = new AppError(
      429,
      'RATE_LIMITED',
      'Later.',
      { limit: 10 },
      { 'Retry-After': '60' },
    )
    expect(toReply(error)?.headers).toEqual({ 'Retry-After': '60' })
  })

  it("maps Nest's own exceptions by status when the contract has a code for it", () => {
    expect(toReply(new NotFoundException('Cannot GET /x'))?.body.error.code).toBe('NOT_FOUND')
    expect(toReply(new ForbiddenException())).toBeNull()
  })

  it('trusts only exposed Express client errors, never an SDK error with a status', () => {
    expect(
      toReply({ expose: true, status: 400, type: 'entity.parse.failed' })?.body.error.code,
    ).toBe('VALIDATION_ERROR')
    expect(toReply({ expose: true, status: 413 })?.body.error.code).toBe('INPUT_TOO_LARGE')
    expect(toReply({ expose: true, status: 415 })?.status).toBe(400)
    expect(toReply({ statusCode: 401, name: 'AI_APICallError' })).toBeNull()
    expect(toReply({ status: 429 })).toBeNull()
  })

  it('answers nothing for an unknown error, so the filter logs it and sends 500 INTERNAL', () => {
    expect(toReply(new Error('boom'))).toBeNull()
  })
})

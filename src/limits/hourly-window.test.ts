import { describe, expect, it } from 'vitest'
import { hourlyWindow } from './hourly-window'

const HOUR = 3_600_000
const now = new Date('2026-10-06T14:00:00.000Z')

describe('hourlyWindow', () => {
  it('frees the next generation when the oldest counted one leaves the window', () => {
    const oldest = new Date('2026-10-06T13:05:00.250Z')
    expect(hourlyWindow({ used: 3, oldest, now }, { perHour: 10, windowMs: HOUR })).toEqual({
      used: 3,
      limit: 10,
      resetsAt: new Date('2026-10-06T14:05:00.250Z'),
      retryAfterSeconds: 301,
      full: false,
    })
  })

  it('points an hour ahead when nothing was started', () => {
    expect(hourlyWindow({ used: 0, oldest: null, now }, { perHour: 10, windowMs: HOUR })).toEqual({
      used: 0,
      limit: 10,
      resetsAt: new Date('2026-10-06T15:00:00.000Z'),
      retryAfterSeconds: 3600,
      full: false,
    })
  })

  it('is full at the limit, and past it when two starts raced', () => {
    const oldest = new Date('2026-10-06T13:30:00.000Z')
    const limits = { perHour: 2, windowMs: HOUR }
    expect(hourlyWindow({ used: 2, oldest, now }, limits)).toMatchObject({
      full: true,
      retryAfterSeconds: 1800,
    })
    expect(hourlyWindow({ used: 3, oldest, now }, limits).full).toBe(true)
  })

  it('never asks to wait less than a second', () => {
    const oldest = new Date(now.getTime() - HOUR + 10)
    expect(
      hourlyWindow({ used: 1, oldest, now }, { perHour: 1, windowMs: HOUR }).retryAfterSeconds,
    ).toBe(1)
  })
})

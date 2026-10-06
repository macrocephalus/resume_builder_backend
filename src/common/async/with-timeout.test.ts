import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError, withTimeout } from './with-timeout'

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers what the promise answers when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1_000, 'work')).resolves.toBe('done')
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'work')).rejects.toThrow(
      'boom',
    )
  })

  it('rejects with a TimeoutError naming the work when it takes longer', async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => undefined)
    const result = withTimeout(never, 2_000, 'queue add')
    vi.advanceTimersByTime(2_000)
    await expect(result).rejects.toThrow(new TimeoutError('queue add took longer than 2000 ms'))
  })

  it('leaves no timer behind', async () => {
    vi.useFakeTimers()
    await withTimeout(Promise.resolve(1), 2_000, 'work')
    expect(vi.getTimerCount()).toBe(0)
  })
})

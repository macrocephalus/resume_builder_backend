import { CV_STATUSES, canTransition } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { fromStatuses } from './from-statuses'

describe('fromStatuses', () => {
  it('lists the statuses the shared machine allows a move from', () => {
    expect(fromStatuses('generating')).toEqual(['queued', 'retrying'])
    expect(fromStatuses('queued')).toEqual(['failed'])
    expect(fromStatuses('ready')).toEqual(['generating', 'needs_input'])
  })

  it('agrees with canTransition for every pair', () => {
    for (const to of CV_STATUSES) {
      for (const from of CV_STATUSES) {
        expect(fromStatuses(to).includes(from)).toBe(canTransition(from, to))
      }
    }
  })
})

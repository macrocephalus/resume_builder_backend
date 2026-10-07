import { describe, expect, it } from 'vitest'
import { grantedWordings } from './wording-budget'

describe('grantedWordings', () => {
  it('gives every answer asked for while the budget lasts', () => {
    expect(grantedWordings({ used: 0, wanted: 3 }, { perHour: 60 })).toBe(3)
    expect(grantedWordings({ used: 57, wanted: 3 }, { perHour: 60 })).toBe(3)
  })

  it('gives what is left of the budget, and nothing past it', () => {
    expect(grantedWordings({ used: 58, wanted: 5 }, { perHour: 60 })).toBe(2)
    expect(grantedWordings({ used: 60, wanted: 1 }, { perHour: 60 })).toBe(0)
    // a budget lowered below what the window already holds
    expect(grantedWordings({ used: 63, wanted: 1 }, { perHour: 60 })).toBe(0)
  })
})

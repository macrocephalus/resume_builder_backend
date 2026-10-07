import { describe, expect, it } from 'vitest'
import { unbackedInWording } from './verify-wording'

const SOURCE = 'Backend engineer at Fintory, built the payments API. Node.js, PostgreSQL, Docker.'

describe('unbackedInWording', () => {
  it('accepts text whose numbers are in the answer and whose technologies are in the answer or the source', () => {
    expect(
      unbackedInWording(
        'Scaled the payments API on Node.js to 1,200 requests per second for 300 companies',
        'about 300 companies, 1200 rps at peak',
        SOURCE,
      ),
    ).toEqual([])
  })

  it('names a number the answer does not give', () => {
    expect(
      unbackedInWording('Served 3 million payments a month', 'about 2M payments a month', SOURCE),
    ).toEqual(['3'])
  })

  it('does not take numbers from the source: the answer is what this text rests on', () => {
    expect(unbackedInWording('Led a team of 8', 'I led the team', 'a team of 8')).toEqual(['8'])
  })

  it('names a technology neither the answer nor the source states', () => {
    expect(
      unbackedInWording('Moved the queue to Kafka on AWS', 'moved the queue to Kafka', SOURCE),
    ).toEqual(['aws'])
  })

  it('compares after normalising case, spaces and digit groups', () => {
    expect(
      unbackedInWording(
        'Cut nightly reports from 40 minutes to 6 on POSTGRESQL',
        'з 40 хв до 6',
        SOURCE,
      ),
    ).toEqual([])
  })
})

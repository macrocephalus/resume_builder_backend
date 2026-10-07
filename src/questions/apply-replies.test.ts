import type { Question } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { JOB, draft } from '../../test/helpers/draft'
import { applyReplies } from './apply-replies'

const question = (overrides: Partial<Question>): Question => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'text',
  origin: 'auto',
  text: 'What is your phone number?',
  label: 'Phone',
  options: [],
  claim: null,
  target: { section: 'contacts', field: 'phone' },
  status: 'open',
  answer: null,
  ...overrides,
})

describe('applyReplies', () => {
  it('writes each answer and keeps it as a fact, in order; a skip changes neither', () => {
    const before = [{ question: 'Earlier?', answer: 'Yes' }]
    const { data, facts } = applyReplies(
      draft(),
      before,
      [
        {
          question: question({ text: 'Skills?', target: { section: 'skills' } }),
          answer: { kind: 'text', value: 'Go, Kafka' },
        },
        { question: question({ text: 'Location?' }), answer: null },
        { question: question({}), answer: { kind: 'text', value: '+380 67 123' } },
      ],
      new Map(),
      () => 'unused',
    )
    expect(data.skills).toEqual(['PostgreSQL', 'Go', 'Kafka'])
    expect(data.contacts.phone).toBe('+380 67 123')
    expect(facts).toEqual([
      ...before,
      { question: 'Skills?', answer: 'Go, Kafka' },
      { question: 'What is your phone number?', answer: '+380 67 123' },
    ])
  })

  it('leaves the draft and the facts as they were for skips only', () => {
    const { data, facts } = applyReplies(
      draft(),
      [],
      [{ question: question({}), answer: null }],
      new Map(),
      () => 'unused',
    )
    expect(data).toEqual(draft())
    expect(facts).toEqual([])
  })

  it('adds the worded bullets of an answer instead of the answer, and keeps the answer as the fact', () => {
    const scale = question({
      text: 'Scale?',
      target: { section: 'experience', itemId: JOB, field: 'bullets' },
    })
    const reply = {
      question: scale,
      answer: { kind: 'text', value: 'about 300 companies' },
    } as const
    const worded = applyReplies(
      draft(),
      [],
      [reply],
      new Map([[scale.id, ['Served 300 companies']]]),
      () => 'x',
    )
    expect(worded.data.experience[0]?.bullets).toEqual([
      'Built the payments API',
      'Served 300 companies',
    ])
    expect(worded.facts).toEqual([{ question: 'Scale?', answer: 'about 300 companies' }])

    const nothing = applyReplies(draft(), [], [reply], new Map([[scale.id, []]]), () => 'x')
    expect(nothing.data).toEqual(draft())
    expect(nothing.facts).toHaveLength(1)
  })
})

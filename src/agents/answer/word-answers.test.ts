import { describe, expect, it } from 'vitest'
import { scriptedModel, textStep } from '../../../test/helpers/model'
import type { WordingRequest } from './answer-wording.schema'
import { wordAnswers } from './word-answers'

/** A result with every field empty. */
const NOTHING = { bullets: [], sentence: null, title: null, company: null, period: null }

const request: WordingRequest = {
  language: 'en',
  targetRole: 'Backend Engineer',
  answers: [
    {
      id: '0',
      kind: 'bullets',
      question: 'Scale?',
      answer: 'about 300 companies',
      item: { title: 'Engineer', company: 'Fintory', bullets: [] },
    },
  ],
}

describe('wordAnswers', () => {
  it('returns the bullets the model wrote for each answer', async () => {
    const model = scriptedModel(
      textStep(
        JSON.stringify({
          answers: [{ ...NOTHING, id: '0', bullets: ['Served about 300 companies'] }],
        }),
      ),
    )
    expect(await wordAnswers(model, request, 1_000)).toEqual([
      { ...NOTHING, id: '0', bullets: ['Served about 300 companies'] },
    ])
  })

  it('throws when the output does not fit the schema, so the caller falls back', async () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => `Did task ${index}`)
    const model = scriptedModel(
      textStep(JSON.stringify({ answers: [{ ...NOTHING, id: '0', bullets: tooMany }] })),
    )
    await expect(wordAnswers(model, request, 1_000)).rejects.toThrow()
  })
})

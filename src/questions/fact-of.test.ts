import type { Question } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { factOf } from './fact-of'

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

describe('factOf', () => {
  it('keeps a text answer as written', () => {
    expect(factOf(question({}), { kind: 'text', value: '+380 67 123 45 67' })).toEqual({
      question: 'What is your phone number?',
      answer: '+380 67 123 45 67',
    })
  })

  it('keeps the picked option or the "Other" text of a choice', () => {
    const level = question({
      kind: 'choice',
      text: 'What is your level of English?',
      label: 'Level',
      options: ['B2', 'C1'],
      target: {
        section: 'languages',
        itemId: '22222222-2222-4222-8222-222222222222',
        field: 'level',
      },
    })
    expect(factOf(level, { kind: 'choice', value: 'B2' }).answer).toBe('B2')
    expect(factOf(level, { kind: 'choice', other: 'Native' }).answer).toBe('Native')
  })

  it('keeps a choice on the skills as the skill it adds, so it backs that skill later', () => {
    const english = question({
      kind: 'choice',
      text: 'What is your level of English?',
      label: 'English',
      options: ['B2', 'C1'],
      target: { section: 'skills' },
    })
    expect(factOf(english, { kind: 'choice', value: 'C1' }).answer).toBe('English: C1')
  })

  it('joins the ticked options and "Other" of a multi', () => {
    const skills = question({
      kind: 'multi',
      text: 'Which of these have you worked with?',
      options: ['Docker', 'Kafka'],
      target: { section: 'skills' },
    })
    expect(factOf(skills, { kind: 'multi', values: ['Docker'], other: 'gRPC, Redis' })).toEqual({
      question: 'Which of these have you worked with?',
      answer: 'Docker, gRPC, Redis',
    })
  })

  describe('a confirm', () => {
    const confirm = question({
      kind: 'confirm',
      origin: 'verifier',
      text: 'Your text does not say this. Should it stay in the CV?',
      claim: 'Led a team of 12 engineers',
      target: {
        section: 'experience',
        itemId: '33333333-3333-4333-8333-333333333333',
        field: 'bullets',
      },
    })

    it('keeps a yes with the claim as its answer, so the claim is backed in later generations', () => {
      expect(factOf(confirm, { kind: 'confirm', value: true })).toEqual({
        question:
          'Your text does not say this. Should it stay in the CV? "Led a team of 12 engineers"',
        answer: 'Led a team of 12 engineers',
      })
    })

    it('keeps a yes as "Yes" when the question has no claim', () => {
      const bare = { ...confirm, claim: null }
      expect(factOf(bare, { kind: 'confirm', value: true })).toEqual({
        question: confirm.text,
        answer: 'Yes',
      })
    })

    it('keeps a no without the claim in its answer, so the claim stays unbacked', () => {
      expect(factOf(confirm, { kind: 'confirm', value: false })).toEqual({
        question:
          'Your text does not say this. Should it stay in the CV? "Led a team of 12 engineers"',
        answer: 'No',
      })
    })
  })
})

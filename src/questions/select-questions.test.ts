import { describe, expect, it } from 'vitest'
import type { NewQuestion } from './new-question'
import { selectQuestions } from './select-questions'

const question = (
  origin: NewQuestion['origin'],
  target: NewQuestion['target'],
  text = `${origin} ${target.section}`,
): NewQuestion => ({ kind: 'text', origin, text, label: 'L', options: [], claim: null, target })

describe('selectQuestions', () => {
  it('keeps auto questions first, then the model questions in their order', () => {
    const auto = [question('auto', { section: 'summary' })]
    const model = [
      question('model', { section: 'languages', field: 'level' }),
      question('model', { section: 'projects' }),
    ]
    expect(selectQuestions({ auto, model }).map((q) => q.text)).toEqual([
      'auto summary',
      'model languages',
      'model projects',
    ])
  })

  it("puts a model question about the same field in the auto one's place", () => {
    const auto = [
      question('auto', { section: 'contacts', field: 'email' }),
      question('auto', { section: 'contacts', field: 'phone' }),
    ]
    const model = [
      question('model', { section: 'projects' }),
      question('model', { section: 'contacts', field: 'email' }, 'Your work email?'),
    ]
    expect(selectQuestions({ auto, model }).map((q) => q.text)).toEqual([
      'Your work email?',
      'auto contacts',
      'model projects',
    ])
  })

  it('lets a model question about the same field replace the auto one', () => {
    const auto = [
      question('auto', { section: 'contacts', field: 'email' }),
      question('auto', { section: 'contacts', field: 'phone' }),
    ]
    const model = [question('model', { section: 'contacts', field: 'phone' }, 'Your work phone?')]
    expect(selectQuestions({ auto, model }).map((q) => q.text)).toEqual([
      'auto contacts',
      'Your work phone?',
    ])
  })
})

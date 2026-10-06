import { describe, expect, it } from 'vitest'
import type { NewQuestion } from './new-question'
import { type QuestionSources, selectQuestions } from './select-questions'

const question = (
  origin: NewQuestion['origin'],
  target: NewQuestion['target'],
  text = `${origin} ${target.section}`,
  kind: NewQuestion['kind'] = 'text',
): NewQuestion => ({ kind, origin, text, label: 'L', options: [], claim: null, target })

const select = (sources: Partial<QuestionSources>) =>
  selectQuestions({ auto: [], confirm: [], cleared: [], multi: null, model: [], ...sources }).map(
    (q) => q.text,
  )

const many = (count: number, make: (index: number) => NewQuestion) =>
  Array.from({ length: count }, (_, index) => make(index))

const JOB = '11111111-1111-4111-8111-111111111111'
const claim = (index: number) =>
  question(
    'verifier',
    { section: 'experience', itemId: JOB, field: 'bullets' },
    `confirm ${index}`,
    'confirm',
  )
const modelAbout = (index: number) =>
  question('model', { section: 'experience', itemId: JOB, field: `f${index}` }, `model ${index}`)

describe('selectQuestions', () => {
  it('keeps auto, then confirm, the cleared fields, the multi and the model questions', () => {
    expect(
      select({
        auto: [question('auto', { section: 'summary' })],
        confirm: [claim(1)],
        cleared: [question('verifier', { section: 'languages', itemId: JOB, field: 'level' })],
        multi: question('verifier', { section: 'skills' }, 'multi', 'multi'),
        model: [modelAbout(1), modelAbout(2)],
      }),
    ).toEqual(['auto summary', 'confirm 1', 'verifier languages', 'multi', 'model 1', 'model 2'])
  })

  it('keeps at most 5 claims and 7 model questions', () => {
    expect(select({ confirm: many(7, claim), model: [] })).toEqual(
      many(5, claim).map((q) => q.text),
    )
    expect(select({ model: many(9, modelAbout) })).toEqual(many(7, modelAbout).map((q) => q.text))
  })

  it('keeps at most 12 questions, dropping the model ones first', () => {
    const auto = many(4, (index) => question('auto', { section: 'contacts', field: `a${index}` }))
    const selected = select({
      auto,
      confirm: many(5, claim),
      multi: question('verifier', { section: 'skills' }, 'multi', 'multi'),
      model: many(7, modelAbout),
    })
    expect(selected).toHaveLength(12)
    expect(selected.slice(-3)).toEqual(['multi', 'model 0', 'model 1'])
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
    expect(select({ auto, model })).toEqual(['Your work email?', 'auto contacts', 'model projects'])
  })

  it('drops a model question about the skills block when the multi asks about it', () => {
    const multi = question('verifier', { section: 'skills' }, 'multi', 'multi')
    const model = [
      question('model', { section: 'skills' }, 'Worked with message queues?'),
      ...many(7, modelAbout),
    ]
    expect(select({ multi, model })).toEqual(['multi', ...many(7, modelAbout).map((q) => q.text)])
    expect(select({ model: model.slice(0, 1) })).toEqual(['Worked with message queues?'])
  })

  it('lets a model question replace a cleared-field question, never a claim', () => {
    const level = { section: 'languages', itemId: JOB, field: 'level' } as const
    const bullets = { section: 'experience', itemId: JOB, field: 'bullets' } as const
    expect(
      select({
        confirm: [claim(1)],
        cleared: [question('verifier', level, 'cleared level')],
        model: [
          question('model', level, 'Your English level?'),
          question('model', bullets, 'Team size?'),
        ],
      }),
    ).toEqual(['confirm 1', 'Your English level?', 'Team size?'])
  })
})

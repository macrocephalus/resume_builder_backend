import type { Question } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { JOB, draft } from '../../test/helpers/draft'
import type { CheckedReply } from './check-replies'
import { acceptWording, answersToWord } from './wording-request'

const question = (id: string, overrides: Partial<Question>): Question => ({
  id,
  kind: 'text',
  origin: 'model',
  text: 'How many companies use it?',
  label: 'Scale',
  options: [],
  claim: null,
  target: { section: 'experience', itemId: JOB, field: 'bullets' },
  status: 'open',
  answer: null,
  ...overrides,
})

const bullets = question('b', {})

describe('answersToWord', () => {
  it('words free text about the bullets of a job, with the job as context', () => {
    const replies: CheckedReply[] = [
      { question: bullets, answer: { kind: 'text', value: 'about 300 companies' } },
      {
        question: question('p', { target: { section: 'contacts', field: 'phone' } }),
        answer: { kind: 'text', value: '+380' },
      },
      { question: question('s', {}), answer: null },
      { question: question('c', { kind: 'confirm' }), answer: { kind: 'confirm', value: true } },
      {
        question: question('e', { target: { section: 'experience' } }),
        answer: { kind: 'text', value: 'A new job' },
      },
    ]
    expect(answersToWord(draft(), replies)).toEqual([
      {
        id: 'b',
        question: 'How many companies use it?',
        answer: 'about 300 companies',
        item: {
          title: 'Backend Engineer',
          company: 'Fintory',
          bullets: ['Built the payments API'],
        },
      },
    ])
  })

  it('words the "Other" of a choice, not a picked option', () => {
    const choice = question('ch', { kind: 'choice', options: ['Small', 'Large'] })
    expect(
      answersToWord(draft(), [
        { question: choice, answer: { kind: 'choice', other: 'about 40 people' } },
      ]).map((toWord) => toWord.answer),
    ).toEqual(['about 40 people'])
    expect(
      answersToWord(draft(), [{ question: choice, answer: { kind: 'choice', value: 'Small' } }]),
    ).toEqual([])
  })
})

describe('acceptWording', () => {
  const all = answersToWord(draft(), [
    { question: bullets, answer: { kind: 'text', value: 'about 300 companies on Kafka' } },
  ])

  it('accepts bullets backed by the answer, an empty list too', () => {
    expect(
      acceptWording(all, [{ id: 'b', bullets: ['Served about 300 companies via Kafka'] }], '')
        .accepted,
    ).toEqual(new Map([['b', ['Served about 300 companies via Kafka']]]))
    expect(acceptWording(all, [{ id: 'b', bullets: [] }], '').accepted).toEqual(
      new Map([['b', []]]),
    )
  })

  it('refuses an invented number or technology, and an answer the model left out', () => {
    expect(acceptWording(all, [{ id: 'b', bullets: ['Served 500 companies'] }], '')).toEqual({
      accepted: new Map(),
      refused: [{ questionId: 'b', reason: 'unbacked', unbacked: ['500'] }],
    })
    expect(
      acceptWording(all, [{ id: 'b', bullets: ['Served 300 companies on AWS'] }], '').refused,
    ).toEqual([{ questionId: 'b', reason: 'unbacked', unbacked: ['aws'] }])
    expect(acceptWording(all, [], '').refused).toEqual([{ questionId: 'b', reason: 'missing' }])
  })
})

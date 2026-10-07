import type { Question } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { JOB, draft } from '../../test/helpers/draft'
import type { WordedAnswer } from '../agents/answer/answer-wording.schema'
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
const summary = question('s', { text: 'More?', target: { section: 'summary' } })
const job = question('j', { text: 'Last job?', target: { section: 'experience' } })

/** A model result for `id` with every field empty but `overrides`. */
const result = (id: string, overrides: Partial<WordedAnswer> = {}): WordedAnswer => ({
  id,
  bullets: [],
  sentence: null,
  title: null,
  company: null,
  period: null,
  ...overrides,
})

const text = (value: string) => ({ kind: 'text', value }) as const

describe('answersToWord', () => {
  it('words free text about the bullets of a job, the summary or a missing job, each with its context', () => {
    const replies: CheckedReply[] = [
      { question: bullets, answer: text('about 300 companies') },
      {
        question: question('p', { target: { section: 'contacts', field: 'phone' } }),
        answer: text('+380'),
      },
      { question: question('n', {}), answer: null },
      { question: question('c', { kind: 'confirm' }), answer: { kind: 'confirm', value: true } },
      { question: summary, answer: text('I mentor juniors') },
      { question: job, answer: text('Dev at Acme') },
    ]
    expect(answersToWord(draft(), replies)).toEqual([
      {
        id: 'b',
        kind: 'bullets',
        question: 'How many companies use it?',
        answer: 'about 300 companies',
        item: {
          title: 'Backend Engineer',
          company: 'Fintory',
          bullets: ['Built the payments API'],
        },
      },
      {
        id: 's',
        kind: 'summary',
        question: 'More?',
        answer: 'I mentor juniors',
        summary: draft().summary,
      },
      { id: 'j', kind: 'job', question: 'Last job?', answer: 'Dev at Acme' },
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
  const toWord = (target: Question, answer: string) =>
    answersToWord(draft(), [{ question: target, answer: text(answer) }])

  it('accepts bullets backed by the answer, an empty list too', () => {
    const all = toWord(bullets, 'about 300 companies on Kafka')
    expect(
      acceptWording(all, [result('b', { bullets: ['Served about 300 companies via Kafka'] })], '')
        .accepted,
    ).toEqual(
      new Map([['b', { kind: 'bullets', bullets: ['Served about 300 companies via Kafka'] }]]),
    )
    expect(acceptWording(all, [result('b')], '').accepted).toEqual(
      new Map([['b', { kind: 'bullets', bullets: [] }]]),
    )
  })

  it('refuses an invented number or technology, too many bullets, and an answer left out', () => {
    const all = toWord(bullets, 'about 300 companies on Kafka')
    expect(acceptWording(all, [result('b', { bullets: ['Served 500 companies'] })], '')).toEqual({
      accepted: new Map(),
      refused: [{ questionId: 'b', reason: 'unbacked', unbacked: ['500'] }],
    })
    expect(
      acceptWording(all, [result('b', { bullets: ['Served 300 companies on AWS'] })], '').refused,
    ).toEqual([{ questionId: 'b', reason: 'unbacked', unbacked: ['aws'] }])
    expect(
      acceptWording(all, [result('b', { bullets: ['A 300', 'B', 'C', 'D'] })], '').refused,
    ).toEqual([{ questionId: 'b', reason: 'shape' }])
    expect(acceptWording(all, [], '').refused).toEqual([{ questionId: 'b', reason: 'missing' }])
  })

  it('accepts a summary sentence backed by the answer, and refuses one that is not', () => {
    const all = toWord(summary, 'I mentor 3 juniors')
    expect(
      acceptWording(all, [result('s', { sentence: 'Mentors 3 junior engineers.' })], '').accepted,
    ).toEqual(new Map([['s', { kind: 'summary', sentence: 'Mentors 3 junior engineers.' }]]))
    expect(
      acceptWording(all, [result('s', { sentence: 'Mentors 5 engineers.' })], '').refused,
    ).toEqual([{ questionId: 's', reason: 'unbacked', unbacked: ['5'] }])
  })

  it('accepts a new job whose title, company and dates are in the answer', () => {
    const all = toWord(job, 'Senior Dev at Acme Corp, 2016-2019, built the billing on Kafka')
    const worded = result('j', {
      title: 'Senior Dev',
      company: 'Acme Corp',
      period: '2016 – 2019',
      bullets: ['Built the billing system on Kafka'],
    })
    expect(acceptWording(all, [worded], '').accepted).toEqual(
      new Map([
        [
          'j',
          {
            kind: 'job',
            job: {
              title: 'Senior Dev',
              company: 'Acme Corp',
              period: '2016 – 2019',
              bullets: ['Built the billing system on Kafka'],
            },
          },
        ],
      ]),
    )
    expect(acceptWording(all, [result('j')], '').accepted).toEqual(
      new Map([['j', { kind: 'job', job: null }]]),
    )
  })

  it('refuses a new job whose title or company is not in the answer, or whose year is made up', () => {
    const all = toWord(job, 'Senior Dev at Acme Corp, 2016-2019')
    expect(
      acceptWording(all, [result('j', { title: 'Lead Engineer', bullets: ['Built it'] })], '')
        .refused,
    ).toEqual([{ questionId: 'j', reason: 'unbacked', unbacked: ['lead engineer'] }])
    expect(
      acceptWording(all, [result('j', { company: 'Globex', bullets: ['Built it'] })], '').refused,
    ).toEqual([{ questionId: 'j', reason: 'unbacked', unbacked: ['globex'] }])
    expect(
      acceptWording(all, [result('j', { period: '2015 – 2019', bullets: ['Built it'] })], '')
        .refused,
    ).toEqual([{ questionId: 'j', reason: 'unbacked', unbacked: ['2015'] }])
  })

  it('compares a title and a company with the answer as whole words', () => {
    const all = toWord(job, 'Developer at Acmesoft')
    expect(
      acceptWording(
        all,
        [result('j', { title: 'Dev', company: 'Acme', bullets: ['Built it'] })],
        '',
      ).refused,
    ).toEqual([{ questionId: 'j', reason: 'unbacked', unbacked: ['dev', 'acme'] }])
  })

  it('refuses a job without bullets, a summary sentence too long, past the shape of its kind', () => {
    expect(
      acceptWording(toWord(job, 'Dev at Acme, 2019'), [result('j', { period: '2019' })], '')
        .refused,
    ).toEqual([{ questionId: 'j', reason: 'shape' }])
    expect(
      acceptWording(toWord(summary, 'mentor'), [result('s', { sentence: 'x'.repeat(301) })], '')
        .refused,
    ).toEqual([{ questionId: 's', reason: 'shape' }])
  })
})

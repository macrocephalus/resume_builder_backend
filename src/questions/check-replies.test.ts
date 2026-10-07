import type { Question, Reply } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JOB, draft } from '../../test/helpers/draft'
import { AppError } from '../common/errors/app-error'
import { checkReplies } from './check-replies'

const PHONE_ID = '11111111-1111-4111-8111-111111111111'
const MULTI_ID = '22222222-2222-4222-8222-222222222222'
const CONFIRM_ID = '33333333-3333-4333-8333-333333333333'

const question = (id: string, overrides: Partial<Question>): Question => ({
  id,
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

const questions = new Map<string, Question>([
  [PHONE_ID, question(PHONE_ID, {})],
  [
    MULTI_ID,
    question(MULTI_ID, {
      kind: 'multi',
      options: ['Docker', 'Kafka'],
      target: { section: 'skills' },
    }),
  ],
  [
    CONFIRM_ID,
    question(CONFIRM_ID, {
      kind: 'confirm',
      claim: 'Led a team of 12',
      target: { section: 'experience', itemId: JOB, field: 'bullets' },
    }),
  ],
])

const phone: Reply = { questionId: PHONE_ID, answer: { kind: 'text', value: ' +380 67 ' } }

/** The error `checkReplies` throws for these replies. */
const refusal = (replies: Reply[], against = questions, data = draft()): AppError => {
  try {
    checkReplies(replies, against, data)
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('the replies were accepted')
}

describe('checkReplies', () => {
  it('returns each reply with its question and its parsed answer, in the order sent', () => {
    const checked = checkReplies(
      [{ questionId: MULTI_ID, answer: null }, phone],
      questions,
      draft(),
    )
    expect(checked.map(({ question: q, answer }) => [q.id, answer])).toEqual([
      [MULTI_ID, null],
      [PHONE_ID, { kind: 'text', value: '+380 67' }],
    ])
  })

  it('is 404 for a question the CV does not have', () => {
    expect(
      refusal([phone, { questionId: '44444444-4444-4444-8444-444444444444', answer: null }]),
    ).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('is 409 for a closed question, another kind or a removed item', () => {
    const closed = new Map(questions)
    closed.set(PHONE_ID, question(PHONE_ID, { status: 'answered' }))
    expect(refusal([phone], closed)).toMatchObject({ status: 409, code: 'INVALID_STATE' })
    expect(
      refusal([{ questionId: PHONE_ID, answer: { kind: 'confirm', value: true } }]),
    ).toMatchObject({ status: 409 })
    expect(
      refusal([{ questionId: CONFIRM_ID, answer: { kind: 'confirm', value: true } }], questions, {
        ...draft(),
        experience: [],
      }),
    ).toMatchObject({ status: 409 })
  })

  it('gathers every reply that does not fit its question into one 400, keyed by its reply', () => {
    const error = refusal([
      { questionId: PHONE_ID, answer: { kind: 'text', value: '   ' } },
      { questionId: MULTI_ID, answer: { kind: 'multi', values: ['Go'] } },
      { questionId: CONFIRM_ID, answer: null },
    ])
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    expect(Object.keys(z.record(z.string(), z.string()).parse(error.details.fields))).toEqual([
      'replies.0.answer.value',
      expect.stringMatching(/^replies\.1\.answer/),
      'replies.2.answer',
    ])
  })
})

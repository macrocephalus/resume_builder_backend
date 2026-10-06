import { randomUUID } from 'node:crypto'
import { cvResponseSchema, errorResponseSchema } from '@cv/shared'
import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvQuestions, cvs } from '../src/database/schema'
import type { NewQuestion } from '../src/questions/new-question'
import { type TestApp, createTestApp } from './helpers/app'
import { JOB, draft, needsInput as needsInputFor, question } from './helpers/draft'
import { completeSubmission, submitStep } from './helpers/model'
import { type TestWorker, startTestWorker, waitForCv } from './helpers/worker'

const CLAIM = 'Led a team of 12 engineers'

const PHONE = question('text', { section: 'contacts', field: 'phone' }, { text: 'Phone?' })
const SKILLS = question('text', { section: 'skills' })
const EXPERIENCE = question('text', { section: 'experience' })
const MULTI = question(
  'multi',
  { section: 'skills' },
  { options: ['Docker', 'Kafka', 'postgresql'] },
)
const CONFIRM = question(
  'confirm',
  { section: 'experience', itemId: JOB, field: 'bullets' },
  { claim: CLAIM, text: 'Your text does not say this. Should it stay in the CV?' },
)

const expectError = (response: request.Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  expect(errorResponseSchema.parse(response.body).error.code).toBe(code)
}

describe('answering and skipping questions', () => {
  let app: TestApp
  let db: Database
  let worker: TestWorker | null = null

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
  })

  afterEach(async () => {
    await worker?.close()
    worker = null
  })

  afterAll(() => app.close())

  const needsInput = (...questions: NewQuestion[]) => needsInputFor(app, ...questions)

  const answer = (cookie: string, cvId: string, questionId: string | undefined, body: object) =>
    request(app.server())
      .post(`/api/cvs/${cvId}/questions/${questionId}/answer`)
      .set('Cookie', cookie)
      .send(body)

  const skip = (cookie: string, cvId: string, questionId: string | undefined) =>
    request(app.server())
      .post(`/api/cvs/${cvId}/questions/${questionId}/skip`)
      .set('Cookie', cookie)

  const cvOf = (response: request.Response) => {
    expect(response.status).toBe(200)
    return cvResponseSchema.parse(response.body).cv
  }

  const factsOf = async (id: string) =>
    (await db.select({ facts: cvs.facts }).from(cvs).where(eq(cvs.id, id)))[0]?.facts

  describe('POST …/answer', () => {
    it('writes a text answer into its field, closes the question and keeps the answer as a fact', async () => {
      const { cookie, id, questionIds } = await needsInput(PHONE, SKILLS)

      const cv = cvOf(
        await answer(cookie, id, questionIds[0], { kind: 'text', value: '+380 67 123 45 67' }),
      )
      expect(cv).toMatchObject({ status: 'needs_input', version: 2 })
      expect(cv.data?.contacts.phone).toBe('+380 67 123 45 67')
      expect(cv.questions.map((q) => [q.id, q.status, q.answer])).toEqual([
        [questionIds[1], 'open', null],
        [questionIds[0], 'answered', '+380 67 123 45 67'],
      ])
      expect(await factsOf(id)).toEqual([{ question: 'Phone?', answer: '+380 67 123 45 67' }])
      const [row] = await db
        .select()
        .from(cvQuestions)
        .where(eq(cvQuestions.id, questionIds[0] ?? ''))
      expect(row?.answeredAt).toBeInstanceOf(Date)
    })

    it('makes the CV ready when the last open question is answered', async () => {
      const { cookie, id, questionIds } = await needsInput(PHONE)
      const cv = cvOf(
        await answer(cookie, id, questionIds[0], { kind: 'text', value: '+380 67 123' }),
      )
      expect(cv).toMatchObject({ status: 'ready', version: 2 })
    })

    it('splits a text answer to the whole skills block into skills', async () => {
      const { cookie, id, questionIds } = await needsInput(SKILLS)
      const cv = cvOf(
        await answer(cookie, id, questionIds[0], { kind: 'text', value: 'Node.js, Docker' }),
      )
      expect(cv.data?.skills).toEqual(['PostgreSQL', 'Node.js', 'Docker'])
    })

    it('turns the answer to the experience block into a new job, one bullet per line', async () => {
      const { cookie, id, questionIds } = await needsInput(EXPERIENCE)
      const cv = cvOf(
        await answer(cookie, id, questionIds[0], {
          kind: 'text',
          value: 'Ran the on-call rotation\n\nWrote the deploy scripts',
        }),
      )
      expect(cv.data?.experience).toEqual([
        draft().experience[0],
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          title: null,
          company: null,
          period: null,
          bullets: ['Ran the on-call rotation', 'Wrote the deploy scripts'],
        },
      ])
    })

    it('appends the ticked options and "Other" of a multi without duplicates', async () => {
      const { cookie, id, questionIds } = await needsInput(MULTI)
      const cv = cvOf(
        await answer(cookie, id, questionIds[0], {
          kind: 'multi',
          values: ['Docker', 'postgresql'],
          other: 'gRPC, docker',
        }),
      )
      expect(cv.data?.skills).toEqual(['PostgreSQL', 'Docker', 'gRPC'])
      expect(cv.questions[0]?.answer).toEqual(['Docker', 'postgresql', 'gRPC', 'docker'])
    })

    it('restores a confirmed bullet and keeps the claim as the fact', async () => {
      const { cookie, id, questionIds } = await needsInput(CONFIRM)
      const cv = cvOf(await answer(cookie, id, questionIds[0], { kind: 'confirm', value: true }))
      expect(cv.data?.experience[0]?.bullets).toEqual(['Built the payments API', CLAIM])
      expect(cv).toMatchObject({ status: 'ready', version: 2 })
      expect(await factsOf(id)).toEqual([{ question: `${CONFIRM.text} "${CLAIM}"`, answer: CLAIM }])
    })

    it('leaves the draft as it was on a no', async () => {
      const { cookie, id, questionIds } = await needsInput(CONFIRM)
      const cv = cvOf(await answer(cookie, id, questionIds[0], { kind: 'confirm', value: false }))
      expect(cv.data).toEqual(draft())
      expect(cv.questions[0]).toMatchObject({ status: 'answered', answer: false })
      expect(await factsOf(id)).toEqual([{ question: `${CONFIRM.text} "${CLAIM}"`, answer: 'No' }])
    })

    it('is 409 INVALID_STATE for a closed question, a CV not waiting for answers, another kind or a removed item', async () => {
      const { cookie, id, questionIds } = await needsInput(PHONE, CONFIRM, SKILLS)
      const [phone, confirm, skills] = questionIds

      cvOf(await answer(cookie, id, phone, { kind: 'text', value: '+380 67 123' }))
      expectError(
        await answer(cookie, id, phone, { kind: 'text', value: '+380 99' }),
        409,
        'INVALID_STATE',
      )
      expectError(
        await answer(cookie, id, skills, { kind: 'confirm', value: true }),
        409,
        'INVALID_STATE',
      )

      await db
        .update(cvs)
        .set({ data: { ...draft(), experience: [] } })
        .where(eq(cvs.id, id))
      expectError(
        await answer(cookie, id, confirm, { kind: 'confirm', value: true }),
        409,
        'INVALID_STATE',
      )

      await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))
      expectError(
        await answer(cookie, id, skills, { kind: 'text', value: 'Go' }),
        409,
        'INVALID_STATE',
      )
      // nothing changed by the refused answers
      const [row] = await db.select().from(cvs).where(eq(cvs.id, id))
      expect(row).toMatchObject({ version: 2, facts: [expect.anything()] })
    })

    it('is 400 VALIDATION_ERROR for an empty or too long value, or a pick that is not an option', async () => {
      const { cookie, id, questionIds } = await needsInput(PHONE, MULTI)
      const [phone, multi] = questionIds
      expectError(
        await answer(cookie, id, phone, { kind: 'text', value: '  ' }),
        400,
        'VALIDATION_ERROR',
      )
      expectError(
        await answer(cookie, id, phone, { kind: 'text', value: 'x'.repeat(1001) }),
        400,
        'VALIDATION_ERROR',
      )
      expectError(
        await answer(cookie, id, multi, { kind: 'multi', values: ['Go'] }),
        400,
        'VALIDATION_ERROR',
      )
      expectError(
        await answer(cookie, id, multi, { kind: 'multi', values: [] }),
        400,
        'VALIDATION_ERROR',
      )
    })

    it('is 404 NOT_FOUND for an unknown question or one of another CV', async () => {
      const { cookie, id } = await needsInput(PHONE)
      const other = await needsInput(PHONE)
      const body = { kind: 'text', value: '+380 67 123' }
      expectError(await answer(cookie, id, randomUUID(), body), 404, 'NOT_FOUND')
      expectError(await answer(cookie, id, 'not-a-uuid', body), 404, 'NOT_FOUND')
      expectError(await answer(cookie, id, other.questionIds[0], body), 404, 'NOT_FOUND')
    })

    it('applies answers sent at once one after another, none lost', async () => {
      const skills = ['Go', 'Rust', 'Kafka', 'Redis', 'Docker', 'gRPC']
      const { cookie, id, questionIds } = await needsInput(...skills.map(() => SKILLS), PHONE)
      const responses = await Promise.all(
        skills.map((value, index) =>
          answer(cookie, id, questionIds[index], { kind: 'text', value }),
        ),
      )
      expect(responses.map((response) => response.status)).toEqual(skills.map(() => 200))
      const [row] = await db.select().from(cvs).where(eq(cvs.id, id))
      expect(new Set(row?.data?.skills)).toEqual(new Set(['PostgreSQL', ...skills]))
      expect(row?.version).toBe(1 + skills.length)
      expect(row?.facts).toHaveLength(skills.length)
    })
  })

  describe('POST …/skip', () => {
    it('closes the question and changes nothing in the draft; the last one makes the CV ready', async () => {
      const { cookie, id, questionIds } = await needsInput(PHONE, MULTI)

      const first = cvOf(await skip(cookie, id, questionIds[0]))
      expect(first).toMatchObject({ status: 'needs_input', version: 1, data: draft() })
      expect(first.questions.find((q) => q.id === questionIds[0])).toMatchObject({
        status: 'skipped',
        answer: null,
      })

      const last = cvOf(await skip(cookie, id, questionIds[1]))
      expect(last).toMatchObject({ status: 'ready', version: 1, data: draft() })
      expect(await factsOf(id)).toEqual([])
    })

    it('is 409 INVALID_STATE for a confirm, a closed question or a CV not waiting for answers', async () => {
      const { cookie, id, questionIds } = await needsInput(CONFIRM, PHONE, SKILLS)
      const [confirm, phone, skills] = questionIds
      expectError(await skip(cookie, id, confirm), 409, 'INVALID_STATE')
      cvOf(await skip(cookie, id, phone))
      expectError(await skip(cookie, id, phone), 409, 'INVALID_STATE')
      await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))
      expectError(await skip(cookie, id, skills), 409, 'INVALID_STATE')
    })

    it('is 404 NOT_FOUND for an unknown question', async () => {
      const { cookie, id } = await needsInput(PHONE)
      expectError(await skip(cookie, id, randomUUID()), 404, 'NOT_FOUND')
    })
  })

  it('feeds the answers to the next generation, where a confirmed bullet passes verification', async () => {
    const prompts: string[] = []
    const confirmed = completeSubmission()
    confirmed.cv.experience[0]?.bullets.push(CLAIM)
    confirmed.evidence.push({ path: 'experience[0].bullets[2]', quote: CLAIM })
    worker = await startTestWorker(
      new MockLanguageModelV4({
        modelId: 'recording',
        doGenerate: async ({ prompt }) => {
          prompts.push(JSON.stringify(prompt))
          return submitStep(confirmed)
        },
      }),
    )
    const { cookie, id, questionIds } = await needsInput(CONFIRM, PHONE)
    cvOf(await answer(cookie, id, questionIds[0], { kind: 'confirm', value: true }))
    cvOf(await answer(cookie, id, questionIds[1], { kind: 'text', value: '+380 67 123 45 67' }))

    // a later generation of the same CV (a new-role CV takes the facts the same way)
    await db.update(cvs).set({ status: 'failed', errorCode: 'INTERNAL' }).where(eq(cvs.id, id))
    expect(
      (await request(app.server()).post(`/api/cvs/${id}/retry`).set('Cookie', cookie)).status,
    ).toBe(202)
    const cv = await waitForCv(app.server(), cookie, id)

    expect(prompts).toHaveLength(1)
    const facts = /<user_facts>(.*?)<\/user_facts>/.exec(prompts[0] ?? '')?.[1]
    expect(facts).toContain(`A: ${CLAIM}`)
    expect(facts).toContain('Q: Phone?\\nA: +380 67 123 45 67')
    expect(cv.data?.experience[0]?.bullets).toContain(CLAIM)
    expect(cv).toMatchObject({
      verification: { sentToConfirm: 0 },
    })
  })
})

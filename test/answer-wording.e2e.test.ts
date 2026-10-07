import { cvResponseSchema } from '@cv/shared'
import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { WordedAnswer } from '../src/agents/answer/answer-wording.schema'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs } from '../src/database/schema'
import { WORDING_BUDGET_DEFAULTS } from '../src/limits/wording-budget'
import { type TestApp, createTestApp } from './helpers/app'
import { JOB, needsInput as needsInputFor, question } from './helpers/draft'
import { SOURCE_TEXT, hangingModel, textStep } from './helpers/model'

const SCALE = question(
  'text',
  { section: 'experience', itemId: JOB, field: 'bullets' },
  { origin: 'model', text: 'How many companies use the payments API?' },
)
const PERIOD = question('text', { section: 'experience', itemId: JOB, field: 'period' })
const PHONE = question('text', { section: 'contacts', field: 'phone' })
const MORE = question('text', { section: 'summary' }, { text: 'Anything to add about you?' })
const LAST_JOB = question('text', { section: 'experience' }, { text: 'Your most recent job?' })
const JOB_ANSWER =
  'Senior Dev at Acme Corp, 2016-2019. Built the billing service, cut invoice errors by 30%'

/** An answer block of the prompt as JSON writes it; the instructions name the tag too. */
const ANSWER_ID = /<answer id=\\"([0-9a-f-]{36})\\" kind/g

/** What the scripted fast model answers, given the answer ids of the prompt; unset fields empty. */
type Respond = (ids: string[]) => Array<Partial<WordedAnswer> & { id: string }> | 'hang'

const NOTHING = { bullets: [], sentence: null, title: null, company: null, period: null }

/** Each test signs up its own user, so only the budget test words more than one answer. */
const BUDGET = { ...WORDING_BUDGET_DEFAULTS, perHour: 2 }

describe('answer wording', () => {
  let app: TestApp
  let db: Database
  let respond: Respond = () => []
  const prompts: string[] = []
  const hanging = hangingModel()

  beforeAll(async () => {
    const fastModel = new MockLanguageModelV4({
      provider: 'test',
      modelId: 'fast',
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt)
        prompts.push(prompt)
        const ids = [...prompt.matchAll(ANSWER_ID)].map((match) => match[1] ?? '')
        const answers = respond(ids)
        if (answers === 'hang') return hanging.doGenerate(options)
        return textStep(
          JSON.stringify({ answers: answers.map((answer) => ({ ...NOTHING, ...answer })) }),
        )
      },
    })
    app = await createTestApp({}, { fastModel, wordingBudget: BUDGET })
    db = app.app.get<Database>(DATABASE)
  })

  beforeEach(() => {
    prompts.length = 0
    respond = () => []
  })

  afterAll(() => app.close())

  const reply = (cookie: string, cvId: string, ...replies: object[]) =>
    request(app.server()).post(`/api/cvs/${cvId}/replies`).set('Cookie', cookie).send({ replies })

  const cvOf = (response: request.Response) => {
    expect(response.status).toBe(200)
    return cvResponseSchema.parse(response.body).cv
  }

  const factsOf = async (id: string) =>
    (await db.select({ facts: cvs.facts }).from(cvs).where(eq(cvs.id, id)))[0]?.facts

  const scaleAnswer = (questionId: string | undefined) => ({
    questionId,
    answer: { kind: 'text', value: 'about 300 companies, 2M payments a month' },
  })

  it('adds the worded bullets to the job and keeps the answer as written in the fact and the question', async () => {
    respond = (ids) =>
      ids.map((id) => ({
        id,
        bullets: ['Served about 300 companies', 'Processed 2M payments a month'],
      }))
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE)

    const cv = cvOf(await reply(cookie, id, scaleAnswer(questionIds[0])))

    expect(cv.data?.experience[0]?.bullets).toEqual([
      'Built the payments API',
      'Served about 300 companies',
      'Processed 2M payments a month',
    ])
    expect(cv.questions[0]).toMatchObject({
      status: 'answered',
      answer: 'about 300 companies, 2M payments a month',
    })
    expect(await factsOf(id)).toEqual([
      { question: SCALE.text, answer: 'about 300 companies, 2M payments a month' },
    ])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Built the payments API')
    expect(prompts[0]).toContain('<cv_language>English</cv_language>')
    // the answer is what the bullets rest on: the model never sees the source
    expect(SOURCE_TEXT).toContain('outbox pattern')
    expect(prompts[0]).not.toContain('outbox pattern')
  })

  it('adds nothing for an answer with nothing for the CV, and still closes the question', async () => {
    respond = (ids) => ids.map((id) => ({ id, bullets: [] }))
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE)
    const cv = cvOf(
      await reply(cookie, id, {
        questionId: questionIds[0],
        answer: { kind: 'text', value: 'no idea, sorry' },
      }),
    )
    expect(cv.data?.experience[0]?.bullets).toEqual(['Built the payments API'])
    expect(cv).toMatchObject({ status: 'ready', version: 2 })
    expect(await factsOf(id)).toEqual([{ question: SCALE.text, answer: 'no idea, sorry' }])
  })

  it('inserts the answer as written when the model invents a number', async () => {
    respond = (ids) => ids.map((id) => ({ id, bullets: ['Served 500 companies'] }))
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE)
    const cv = cvOf(await reply(cookie, id, scaleAnswer(questionIds[0])))
    expect(cv.data?.experience[0]?.bullets).toEqual([
      'Built the payments API',
      'about 300 companies, 2M payments a month',
    ])
  })

  it('inserts the answer as written when the model does not answer in time', async () => {
    respond = () => 'hang'
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE)
    const cv = cvOf(await reply(cookie, id, scaleAnswer(questionIds[0])))
    expect(cv.data?.experience[0]?.bullets).toEqual([
      'Built the payments API',
      'about 300 companies, 2M payments a month',
    ])
  })

  it('words only the bullets answers of a batch, in one call', async () => {
    respond = (ids) => ids.map((id) => ({ id, bullets: ['Served about 300 companies'] }))
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE, PERIOD, PHONE)
    const cv = cvOf(
      await reply(
        cookie,
        id,
        scaleAnswer(questionIds[0]),
        { questionId: questionIds[1], answer: { kind: 'text', value: '2019 – 2023' } },
        { questionId: questionIds[2], answer: null },
      ),
    )
    expect(prompts).toHaveLength(1)
    expect([...(prompts[0] ?? '').matchAll(ANSWER_ID)]).toHaveLength(1)
    expect(cv.data?.experience[0]).toMatchObject({
      period: '2019 – 2023',
      bullets: ['Built the payments API', 'Served about 300 companies'],
    })
  })

  it('makes no model call for a batch it refuses', async () => {
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE)
    await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))
    expect((await reply(cookie, id, scaleAnswer(questionIds[0]))).status).toBe(409)
    expect(prompts).toEqual([])
  })

  it('appends a worded sentence to the summary, which is not rewritten', async () => {
    respond = (ids) => ids.map((id) => ({ id, sentence: 'Mentors 3 junior engineers.' }))
    const { cookie, id, questionIds } = await needsInputFor(app, MORE)
    const cv = cvOf(
      await reply(cookie, id, {
        questionId: questionIds[0],
        answer: { kind: 'text', value: 'i mentor 3 juniors' },
      }),
    )
    expect(cv.data?.summary).toBe(
      'Backend engineer with eight years of Node.js and PostgreSQL in payments. Mentors 3 junior engineers.',
    )
    expect(prompts[0]).toContain('kind=\\"summary\\"')
  })

  it('adds a worded new job with its title, company, dates and bullets', async () => {
    respond = (ids) =>
      ids.map((id) => ({
        id,
        title: 'Senior Dev',
        company: 'Acme Corp',
        period: '2016 – 2019',
        bullets: ['Built the billing service', 'Cut invoice errors by 30%'],
      }))
    const { cookie, id, questionIds } = await needsInputFor(app, LAST_JOB)
    const cv = cvOf(
      await reply(cookie, id, {
        questionId: questionIds[0],
        answer: { kind: 'text', value: JOB_ANSWER },
      }),
    )
    expect(cv.data?.experience).toHaveLength(2)
    expect(cv.data?.experience[1]).toMatchObject({
      title: 'Senior Dev',
      company: 'Acme Corp',
      period: '2016 – 2019',
      bullets: ['Built the billing service', 'Cut invoice errors by 30%'],
    })
    expect(await factsOf(id)).toEqual([{ question: LAST_JOB.text, answer: JOB_ANSWER }])
  })

  /** The job an answer as written makes: its lines as bullets, every field empty. */
  const asWritten = { title: null, company: null, period: null, bullets: [JOB_ANSWER] }

  it('inserts the job as written when its title is not in the answer', async () => {
    respond = (ids) =>
      ids.map((id) => ({ id, title: 'Lead Engineer', bullets: ['Built the billing service'] }))
    const { cookie, id, questionIds } = await needsInputFor(app, LAST_JOB)
    const cv = cvOf(
      await reply(cookie, id, {
        questionId: questionIds[0],
        answer: { kind: 'text', value: JOB_ANSWER },
      }),
    )
    expect(cv.data?.experience[1]).toMatchObject(asWritten)
  })

  it('inserts the job as written when its period has a year the answer does not give', async () => {
    respond = (ids) =>
      ids.map((id) => ({ id, period: '2015 – 2019', bullets: ['Built the billing service'] }))
    const { cookie, id, questionIds } = await needsInputFor(app, LAST_JOB)
    const cv = cvOf(
      await reply(cookie, id, {
        questionId: questionIds[0],
        answer: { kind: 'text', value: JOB_ANSWER },
      }),
    )
    expect(cv.data?.experience[1]).toMatchObject(asWritten)
  })

  it('inserts answers as written past the budget, without refusing them', async () => {
    respond = (ids) =>
      ids.map((id) => ({
        id,
        bullets: ['Served about 300 companies'],
        sentence: 'Mentors 3 junior engineers.',
      }))
    const AGAIN = question('text', { section: 'experience', itemId: JOB, field: 'bullets' })
    const { cookie, id, questionIds } = await needsInputFor(app, SCALE, MORE, LAST_JOB, AGAIN)
    const [scale, more, lastJob, again] = questionIds

    cvOf(await reply(cookie, id, scaleAnswer(scale)))
    // one answer of the budget left: the first of the batch is worded, the next goes in as written
    const cv = cvOf(
      await reply(
        cookie,
        id,
        { questionId: more, answer: { kind: 'text', value: 'i mentor 3 juniors' } },
        { questionId: lastJob, answer: { kind: 'text', value: JOB_ANSWER } },
      ),
    )
    expect(prompts).toHaveLength(2)
    expect([...(prompts[1] ?? '').matchAll(ANSWER_ID)].map((match) => match[1])).toEqual([more])
    expect(cv.data?.summary).toMatch(/Mentors 3 junior engineers\.$/)
    expect(cv.data?.experience[1]).toMatchObject(asWritten)

    const last = cvOf(
      await reply(cookie, id, {
        questionId: again,
        answer: { kind: 'text', value: 'about 40 engineers' },
      }),
    )
    expect(prompts).toHaveLength(2)
    expect(last.data?.experience[0]?.bullets).toEqual([
      'Built the payments API',
      'Served about 300 companies',
      'about 40 engineers',
    ])
    expect(last.status).toBe('ready')
  })
})

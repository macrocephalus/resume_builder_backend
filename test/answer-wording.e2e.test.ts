import { cvResponseSchema } from '@cv/shared'
import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs } from '../src/database/schema'
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

/** An answer block of the prompt as JSON writes it; the instructions name the tag too. */
const ANSWER_ID = /<answer id=\\"([0-9a-f-]{36})\\">/g

/** What the scripted fast model answers, given the answer ids of the prompt. */
type Respond = (ids: string[]) => Array<{ id: string; bullets: string[] }> | 'hang'

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
        return textStep(JSON.stringify({ answers }))
      },
    })
    app = await createTestApp({}, { fastModel })
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
})

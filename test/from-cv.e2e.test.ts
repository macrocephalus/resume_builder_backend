import { randomUUID } from 'node:crypto'
import { type CvStatus, cvResponseSchema, errorResponseSchema } from '@cv/shared'
import { MockLanguageModelV4 } from 'ai/test'
import { asc, eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvQuestions, cvs, generationJobs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { needsInput, question } from './helpers/draft'
import { TEST_LIMITS } from './helpers/env'
import { SOURCE_TEXT, completeSubmission, submitStep } from './helpers/model'
import { type TestWorker, startTestWorker, waitForCv } from './helpers/worker'

const PHONE_ANSWER = '+380 67 123 45 67'
const PHONE = question('text', { section: 'contacts', field: 'phone' }, { text: 'Your phone?' })

describe('POST /api/cvs with fromCvId (a CV for another role)', () => {
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

  const create = (cookie: string, fromCvId: string, rest: Record<string, unknown> = {}) =>
    request(app.server())
      .post('/api/cvs')
      .set('Cookie', cookie)
      .send({ targetRole: 'Node.js Tech Lead', fromCvId, ...rest })

  const cvOf = (response: request.Response) => {
    expect(response.status).toBe(202)
    return cvResponseSchema.parse(response.body).cv
  }

  const errorOf = (response: request.Response, status: number) => {
    expect(response.status).toBe(status)
    return errorResponseSchema.parse(response.body).error
  }

  const stored = async (id: string) => (await db.select().from(cvs).where(eq(cvs.id, id)))[0]

  const questionsOf = (cvId: string) =>
    db
      .select()
      .from(cvQuestions)
      .where(eq(cvQuestions.cvId, cvId))
      .orderBy(asc(cvQuestions.position))

  /** A finished CV whose phone question the user answered, so it has one fact. */
  const answeredParent = async () => {
    const parent = await needsInput(app, PHONE)
    const response = await request(app.server())
      .post(`/api/cvs/${parent.id}/questions/${parent.questionIds[0]}/answer`)
      .set('Cookie', parent.cookie)
      .send({ kind: 'text', value: PHONE_ANSWER })
    expect(response.status).toBe(200)
    return parent
  }

  it('queues a new CV with the source and facts of the parent and the role and language of the body', async () => {
    const { cookie, id } = await answeredParent()
    await db
      .update(cvs)
      .set({ sourceType: 'pdf', sourceFilename: 'olena-cv.pdf' })
      .where(eq(cvs.id, id))
    const parent = await stored(id)
    const parentQuestions = await questionsOf(id)

    const cv = cvOf(
      await create(cookie, id, {
        roleContext: 'Leading a team of five',
        language: 'uk',
        // the source is the parent's, whatever the body says
        sourceType: 'text',
        sourceFilename: 'other.pdf',
      }),
    )
    expect(cv).toMatchObject({
      status: 'queued',
      attempt: 1,
      title: 'Node.js Tech Lead',
      targetRole: 'Node.js Tech Lead',
      roleContext: 'Leading a team of five',
      language: 'uk',
      sourceType: 'pdf',
      sourceFilename: 'olena-cv.pdf',
      data: null,
      version: 0,
      questions: [],
    })
    expect(await stored(cv.id)).toMatchObject({
      userId: parent?.userId,
      parentCvId: id,
      sourceText: SOURCE_TEXT,
      facts: [{ question: 'Your phone?', answer: PHONE_ANSWER }],
    })
    expect(await db.select().from(generationJobs).where(eq(generationJobs.cvId, cv.id))).toEqual([
      expect.objectContaining({ userId: parent?.userId }),
    ])

    expect(await stored(id)).toEqual(parent)
    expect(await questionsOf(id)).toEqual(parentQuestions)
  })

  it('generates the new CV with the facts of the parent in the prompt', async () => {
    const { cookie, id } = await answeredParent()
    const child = cvOf(await create(cookie, id))
    const parent = await stored(id)
    const prompts: string[] = []
    worker = await startTestWorker(
      new MockLanguageModelV4({
        modelId: 'recording',
        doGenerate: async ({ prompt }) => {
          prompts.push(JSON.stringify(prompt))
          return submitStep(completeSubmission())
        },
      }),
    )

    const cv = await waitForCv(app.server(), cookie, child.id)
    expect(cv.data?.contacts.fullName).toBe('Olena Hnatiuk')
    // the parent's own job finds it finished and ends without a model call
    expect(prompts).toHaveLength(1)
    // the prompt as JSON: its newlines are `\\n`
    expect(prompts[0]).toContain(
      `<user_facts>\\nQ: Your phone?\\nA: ${PHONE_ANSWER}\\n</user_facts>`,
    )
    expect(prompts[0]).toContain('<target_role>Node.js Tech Lead</target_role>')
    expect(await stored(id)).toEqual(parent)
  })

  it('takes a ready parent too', async () => {
    const { cookie, id } = await needsInput(app)
    await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))
    expect(cvOf(await create(cookie, id)).status).toBe('queued')
  })

  it('is 409 INVALID_STATE for a parent without a draft, and writes nothing', async () => {
    const { cookie, id } = await needsInput(app)
    const statuses: CvStatus[] = ['queued', 'generating', 'retrying', 'failed']
    for (const status of statuses) {
      await db.update(cvs).set({ status }).where(eq(cvs.id, id))
      expect(errorOf(await create(cookie, id), 409).code).toBe('INVALID_STATE')
    }
    expect(await db.select().from(cvs)).toHaveLength(1)
    expect(await db.select().from(generationJobs)).toHaveLength(1)
  })

  it("is 404 NOT_FOUND for another user's CV or a missing one", async () => {
    const { id } = await needsInput(app)
    const other = await signUp(app.server(), `${randomUUID()}@example.com`)
    expect(errorOf(await create(other.cookie, id), 404).code).toBe('NOT_FOUND')
    expect(errorOf(await create(other.cookie, randomUUID()), 404).code).toBe('NOT_FOUND')
    expect(await db.select().from(cvs)).toHaveLength(1)
  })

  it('is 400 VALIDATION_ERROR for both fromCvId and sourceText, or neither', async () => {
    const { cookie, id } = await needsInput(app)
    expect(errorOf(await create(cookie, id, { sourceText: SOURCE_TEXT }), 400).code).toBe(
      'VALIDATION_ERROR',
    )
    const neither = await request(app.server())
      .post('/api/cvs')
      .set('Cookie', cookie)
      .send({ targetRole: 'Node.js Tech Lead' })
    expect(errorOf(neither, 400).code).toBe('VALIDATION_ERROR')
    expect(await db.select().from(cvs)).toHaveLength(1)
  })

  it('counts toward the limit of CVs in progress', async () => {
    const { cookie, id } = await needsInput(app)
    for (let i = 0; i < TEST_LIMITS.activePerUser; i++) cvOf(await create(cookie, id))
    expect(errorOf(await create(cookie, id), 429).code).toBe('TOO_MANY_ACTIVE')
  })

  it('keeps the new CV when the parent is deleted, without its parent', async () => {
    const { cookie, id } = await needsInput(app)
    const child = cvOf(await create(cookie, id))
    const deleted = await request(app.server()).delete(`/api/cvs/${id}`).set('Cookie', cookie)
    expect(deleted.status).toBe(204)
    expect(await stored(child.id)).toMatchObject({ parentCvId: null, sourceText: SOURCE_TEXT })
  })

  it('makes a new CV from a CV that was itself made for another role', async () => {
    const { cookie, id } = await needsInput(app)
    const child = cvOf(await create(cookie, id))
    await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, child.id))
    const grandchild = cvOf(await create(cookie, child.id, { targetRole: 'Staff Engineer' }))
    expect(await stored(grandchild.id)).toMatchObject({ parentCvId: child.id })
  })
})

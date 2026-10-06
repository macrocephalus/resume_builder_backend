import { randomUUID } from 'node:crypto'
import {
  cvListResponseSchema,
  cvResponseSchema,
  cvStatusesResponseSchema,
  errorResponseSchema,
} from '@cv/shared'
import type { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GENERATION } from '../src/config/limits'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvQuestions, cvs, generationJobs } from '../src/database/schema'
import { GENERATION_QUEUE } from '../src/generation/generation.queue'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { createCv, newCvBody } from './helpers/cvs'
import { SOURCE_TEXT } from './helpers/model'

const expectError = (response: request.Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  expect(errorResponseSchema.parse(response.body).error.code).toBe(code)
}

/** An open text question about the phone, for a CV the test created. */
const questionRow = (cvId: string, position: number, status: 'open' | 'skipped' = 'open') => ({
  cvId,
  kind: 'text' as const,
  origin: 'auto' as const,
  text: `Question ${position}?`,
  label: `Label ${position}`,
  target: { section: 'contacts' as const, field: 'phone' as const },
  status,
  position,
})

const fieldsOf = (response: request.Response): string[] =>
  Object.keys(
    z
      .object({ fields: z.record(z.string(), z.string()) })
      .parse(errorResponseSchema.parse(response.body).error.details).fields,
  )

describe('CVs before generation', () => {
  let app: TestApp
  let db: Database

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
  })

  afterAll(() => app.close())

  const as = (cookie: string) => ({
    get: (path: string) => request(app.server()).get(path).set('Cookie', cookie),
    post: (path: string) => request(app.server()).post(path).set('Cookie', cookie),
    patch: (path: string) => request(app.server()).patch(path).set('Cookie', cookie),
    delete: (path: string) => request(app.server()).delete(path).set('Cookie', cookie),
  })

  const statuses = async (cookie: string, ids: string[]) => {
    const response = await as(cookie).get(`/api/cvs/statuses?ids=${ids.join(',')}`)
    expect(response.status).toBe(200)
    return cvStatusesResponseSchema.parse(response.body).items
  }

  it('needs a session', async () => {
    expectError(await request(app.server()).get('/api/cvs'), 401, 'UNAUTHORIZED')
    expectError(await request(app.server()).post('/api/cvs').send(newCvBody()), 401, 'UNAUTHORIZED')
  })

  describe('POST /api/cvs', () => {
    it('creates a queued CV titled after the role and puts its generation job on the queue', async () => {
      const { id: userId, cookie } = await signUp(app.server())
      const response = await as(cookie)
        .post('/api/cvs')
        .send(
          newCvBody({
            targetRole: '  Senior Backend Engineer ',
            roleContext: 'Fintech, mentoring juniors',
            sourceType: 'pdf',
            sourceFilename: 'olena-cv.pdf',
          }),
        )

      expect(response.status).toBe(202)
      const { cv } = cvResponseSchema.parse(response.body)
      expect(cv).toMatchObject({
        status: 'queued',
        stage: null,
        attempt: 1,
        maxAttempts: 3,
        queuePosition: 1,
        errorCode: null,
        error: null,
        title: 'Senior Backend Engineer',
        targetRole: 'Senior Backend Engineer',
        roleContext: 'Fintech, mentoring juniors',
        language: 'en',
        sourceType: 'pdf',
        sourceFilename: 'olena-cv.pdf',
        data: null,
        version: 0,
        requirements: [],
        suggestedRoles: [],
        verification: null,
        questions: [],
      })

      const [row] = await db.select().from(cvs).where(eq(cvs.id, cv.id))
      expect(row).toMatchObject({ userId, sourceText: SOURCE_TEXT, facts: [] })

      const jobs = await db.select().from(generationJobs).where(eq(generationJobs.cvId, cv.id))
      expect(jobs).toEqual([expect.objectContaining({ userId })])
      const job = await app.app.get<Queue>(GENERATION_QUEUE).getJob(jobs[0]?.id ?? '')
      expect(job?.data).toEqual({ cvId: cv.id })
    })

    it('defaults the language to en and the source type to text, and keeps a chosen language', async () => {
      const { cookie } = await signUp(app.server())
      expect(await createCv(app.server(), cookie)).toMatchObject({
        language: 'en',
        sourceType: 'text',
        sourceFilename: null,
        roleContext: null,
      })
      expect((await createCv(app.server(), cookie, { language: 'uk' })).language).toBe('uk')
    })

    it('is 400 VALIDATION_ERROR naming each bad field', async () => {
      const { cookie } = await signUp(app.server())
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ targetRole: 'x' }, 'targetRole'],
        [{ targetRole: 'x'.repeat(101) }, 'targetRole'],
        [{ roleContext: 'x'.repeat(5001) }, 'roleContext'],
        [{ language: 'xx' }, 'language'],
        [{ sourceText: 'x'.repeat(79) }, 'sourceText'],
        [{ sourceText: 'x'.repeat(20_001) }, 'sourceText'],
        [{ sourceType: 'docx' }, 'sourceType'],
        [{ sourceFilename: 'x'.repeat(201) }, 'sourceFilename'],
      ]
      for (const [overrides, field] of cases) {
        const response = await as(cookie).post('/api/cvs').send(newCvBody(overrides))
        expectError(response, 400, 'VALIDATION_ERROR')
        expect(fieldsOf(response)).toContain(field)
      }
      expect(await db.select().from(cvs)).toEqual([])
    })

    it('refuses fromCvId with 400 for now', async () => {
      const { cookie } = await signUp(app.server())
      const parent = await createCv(app.server(), cookie)
      const response = await as(cookie)
        .post('/api/cvs')
        .send({ targetRole: 'Node.js Tech Lead', fromCvId: parent.id })
      expectError(response, 400, 'VALIDATION_ERROR')
      expect(fieldsOf(response)).toEqual(['fromCvId'])
    })

    it('refuses one CV in progress over the limit with 429 TOO_MANY_ACTIVE and writes nothing', async () => {
      const { cookie } = await signUp(app.server())
      const limit = GENERATION.activePerUser
      for (let i = 0; i < limit; i++) await createCv(app.server(), cookie)

      const response = await as(cookie).post('/api/cvs').send(newCvBody())
      expectError(response, 429, 'TOO_MANY_ACTIVE')
      expect(errorResponseSchema.parse(response.body).error.details).toEqual({ limit })
      expect(await db.select().from(cvs)).toHaveLength(limit)
      expect(await db.select().from(generationJobs)).toHaveLength(limit)
    })

    it('answers 202 within the enqueue timeout when Redis is down; the job row stays for recovery', async () => {
      // nothing listens on port 1: every Redis command waits for a reconnect that never comes
      const noRedis = await createTestApp({ REDIS_URL: 'redis://127.0.0.1:1' })
      try {
        const { cookie } = await signUp(noRedis.server())
        const started = Date.now()
        const cv = await createCv(noRedis.server(), cookie)
        // the request never waits on Redis for long (TIMEOUTS.enqueueMs)
        expect(Date.now() - started).toBeLessThan(5_000)
        expect(cv.status).toBe('queued')
        const jobs = await db.select().from(generationJobs).where(eq(generationJobs.cvId, cv.id))
        expect(jobs).toHaveLength(1)
      } finally {
        await noRedis.close()
      }
    })
  })

  describe('the queue position', () => {
    it('counts the queued CVs of every user created earlier', async () => {
      const ann = await signUp(app.server(), 'ann@example.com')
      const bob = await signUp(app.server(), 'bob@example.com')
      const first = await createCv(app.server(), ann.cookie)
      const second = await createCv(app.server(), bob.cookie)
      const third = await createCv(app.server(), ann.cookie)

      expect([first, second, third].map((cv) => cv.queuePosition)).toEqual([1, 2, 3])
      expect(
        (await statuses(ann.cookie, [first.id, third.id])).map((item) => item.queuePosition).sort(),
      ).toEqual([1, 3])

      // a CV that leaves the queue moves the ones behind it up
      await as(ann.cookie).delete(`/api/cvs/${first.id}`)
      expect((await statuses(bob.cookie, [second.id]))[0]?.queuePosition).toBe(1)
      expect((await statuses(ann.cookie, [third.id]))[0]?.queuePosition).toBe(2)
    })
  })

  describe('GET /api/cvs', () => {
    it("lists the user's own CVs, newest change first, without match or questions yet", async () => {
      const ann = await signUp(app.server(), 'ann@example.com')
      const bob = await signUp(app.server(), 'bob@example.com')
      const older = await createCv(app.server(), ann.cookie, { targetRole: 'Backend Engineer' })
      const newer = await createCv(app.server(), ann.cookie, { targetRole: 'Tech Lead' })
      await createCv(app.server(), bob.cookie)

      const response = await as(ann.cookie).get('/api/cvs')
      expect(response.status).toBe(200)
      const { items } = cvListResponseSchema.parse(response.body)
      expect(items.map((item) => item.id)).toEqual([newer.id, older.id])
      expect(items[0]).toEqual({
        id: newer.id,
        title: 'Tech Lead',
        targetRole: 'Tech Lead',
        language: 'en',
        status: 'queued',
        openQuestions: 0,
        match: null,
        createdAt: newer.createdAt,
        updatedAt: newer.updatedAt,
      })
    })

    it('is empty for a new user', async () => {
      const { cookie } = await signUp(app.server())
      expect((await as(cookie).get('/api/cvs')).body).toEqual({ items: [] })
    })
  })

  describe('GET /api/cvs/statuses', () => {
    it('answers the light part of each own CV and omits unknown ids', async () => {
      const { cookie } = await signUp(app.server())
      const cv = await createCv(app.server(), cookie)
      const items = await statuses(cookie, [cv.id, randomUUID()])
      expect(items).toEqual([
        {
          id: cv.id,
          status: 'queued',
          stage: null,
          attempt: 1,
          maxAttempts: 3,
          queuePosition: 1,
          errorCode: null,
          error: null,
          updatedAt: cv.updatedAt,
        },
      ])
    })

    it('takes 1 to 50 ids, else 400', async () => {
      const { cookie } = await signUp(app.server())
      expectError(await as(cookie).get('/api/cvs/statuses'), 400, 'VALIDATION_ERROR')
      expectError(await as(cookie).get('/api/cvs/statuses?ids='), 400, 'VALIDATION_ERROR')
      expectError(await as(cookie).get('/api/cvs/statuses?ids=abc'), 400, 'VALIDATION_ERROR')
      const tooMany = Array.from({ length: 51 }, () => randomUUID())
      expectError(
        await as(cookie).get(`/api/cvs/statuses?ids=${tooMany.join(',')}`),
        400,
        'VALIDATION_ERROR',
      )
      expect(await statuses(cookie, tooMany.slice(0, 50))).toEqual([])
    })
  })

  describe('GET /api/cvs/:id', () => {
    it('answers the whole CV with its questions, open first', async () => {
      const { cookie } = await signUp(app.server())
      const cv = await createCv(app.server(), cookie)
      await db
        .insert(cvQuestions)
        .values([questionRow(cv.id, 1, 'skipped'), questionRow(cv.id, 2, 'open')])

      const response = await as(cookie).get(`/api/cvs/${cv.id}`)
      expect(response.status).toBe(200)
      const { cv: got } = cvResponseSchema.parse(response.body)
      expect(got.questions.map((q) => [q.text, q.status, q.options, q.answer])).toEqual([
        ['Question 2?', 'open', [], null],
        ['Question 1?', 'skipped', [], null],
      ])
    })

    it('is 404 NOT_FOUND for an unknown id or one that is not a UUID', async () => {
      const { cookie } = await signUp(app.server())
      expectError(await as(cookie).get(`/api/cvs/${randomUUID()}`), 404, 'NOT_FOUND')
      expectError(await as(cookie).get('/api/cvs/not-a-uuid'), 404, 'NOT_FOUND')
    })
  })

  describe('DELETE /api/cvs/:id', () => {
    it('deletes the CV and its questions, and keeps its generation job without the CV', async () => {
      const { cookie } = await signUp(app.server())
      const cv = await createCv(app.server(), cookie)
      await db.insert(cvQuestions).values(questionRow(cv.id, 1))

      expect((await as(cookie).delete(`/api/cvs/${cv.id}`)).status).toBe(204)
      expectError(await as(cookie).get(`/api/cvs/${cv.id}`), 404, 'NOT_FOUND')
      expect(await db.select().from(cvQuestions)).toEqual([])
      expect(await db.select().from(generationJobs)).toEqual([
        expect.objectContaining({ cvId: null }),
      ])
      expectError(await as(cookie).delete(`/api/cvs/${cv.id}`), 404, 'NOT_FOUND')
    })
  })

  describe('isolation', () => {
    it("treats another user's CV exactly like a missing one on every route", async () => {
      const ann = await signUp(app.server(), 'ann@example.com')
      const bob = await signUp(app.server(), 'bob@example.com')
      // a userId in the body is ignored: the CV is Ann's
      const cv = await createCv(app.server(), ann.cookie, { userId: bob.id })
      // Ann's CV waits for an answer to a real question, so only the owner check can refuse Bob
      await db.update(cvs).set({ status: 'needs_input' }).where(eq(cvs.id, cv.id))
      const [question] = await db
        .insert(cvQuestions)
        .values(questionRow(cv.id, 1))
        .returning({ id: cvQuestions.id })
      const questionId = question?.id
      const bobs = as(bob.cookie)

      const routes = [
        () => bobs.get(`/api/cvs/${cv.id}`),
        () => bobs.delete(`/api/cvs/${cv.id}`),
        () => bobs.patch(`/api/cvs/${cv.id}`).send({ version: 0, title: 'Mine now' }),
        () => bobs.post(`/api/cvs/${cv.id}/retry`),
        () => bobs.get(`/api/cvs/${cv.id}/pdf`),
        () =>
          bobs
            .post(`/api/cvs/${cv.id}/questions/${questionId}/answer`)
            .send({ kind: 'text', value: 'x' }),
        () => bobs.post(`/api/cvs/${cv.id}/questions/${questionId}/skip`),
      ]
      // one at a time: each request starts the test server
      for (const route of routes) expectError(await route(), 404, 'NOT_FOUND')

      expect(await statuses(bob.cookie, [cv.id])).toEqual([])
      expect((await bobs.get('/api/cvs')).body).toEqual({ items: [] })

      // and it is all still there for Ann
      const own = await as(ann.cookie).get(`/api/cvs/${cv.id}`)
      expect(own.status).toBe(200)
      const { cv: owned } = cvResponseSchema.parse(own.body)
      expect(owned.title).toBe(cv.title)
      expect(owned.questions.map((q) => q.status)).toEqual(['open'])
    })
  })
})

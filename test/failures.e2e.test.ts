import { cvResponseSchema, errorResponseSchema } from '@cv/shared'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import IORedis, { type Redis } from 'ioredis'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CvStatusService } from '../src/cvs/cv-status.service'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs, generationAttempts, generationJobs } from '../src/database/schema'
import { GENERATION_QUEUE_NAME } from '../src/generation/generation.queue'
import { REDIS } from '../src/redis/redis.module'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { createCv } from './helpers/cvs'
import { TEST_LIMITS, TEST_QUEUE_PREFIX, testEnv } from './helpers/env'
import {
  SOURCE_TEXT,
  apiError,
  completeSubmission,
  hangingModel,
  scriptedModel,
  submitStep,
  textStep,
} from './helpers/model'
import { type TestWorker, startTestWorker, waitForCv, waitUntil, watchCv } from './helpers/worker'

/** One failed attempt of the model: the call and the SDK's two retries of it. */
const overloaded = () => [apiError(529), apiError(529), apiError(529)]

describe('generation failures, retries and recovery (scripted model)', () => {
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

  const attempts = async () =>
    (await db.select().from(generationAttempts).orderBy(generationAttempts.createdAt)).map(
      (row) => [row.attempt, row.status, row.error],
    )

  it('retries an attempt the API was overloaded for and saves the draft of the next one', async () => {
    const model = scriptedModel(...overloaded(), submitStep(completeSubmission()))
    worker = await startTestWorker(model)
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const { cv, seen } = await watchCv(app.server(), cookie, created.id)
    expect(seen).toContain('retrying 1')
    expect(seen.at(-1)).toBe('ready 2')
    expect(cv).toMatchObject({ status: 'ready', attempt: 2, errorCode: null, error: null })
    expect(model.doGenerateCalls).toHaveLength(4)
    expect(await attempts()).toEqual([
      [1, 'failed', expect.stringMatching(/^AI_RetryError: Failed after 3 attempts/)],
      [2, 'succeeded', null],
    ])
  })

  it('fails with LLM_UNAVAILABLE after three overloaded attempts', async () => {
    worker = await startTestWorker(scriptedModel(...overloaded(), ...overloaded(), ...overloaded()))
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const { cv, seen } = await watchCv(app.server(), cookie, created.id)
    expect(seen).toEqual(expect.arrayContaining(['retrying 1', 'retrying 2']))
    expect(cv).toMatchObject({
      status: 'failed',
      attempt: 3,
      maxAttempts: 3,
      stage: null,
      errorCode: 'LLM_UNAVAILABLE',
      error: 'The AI service is unavailable right now. Try again in a few minutes.',
      data: null,
    })
    expect((await attempts()).map(([attempt, status]) => [attempt, status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'failed'],
    ])
  })

  it('fails with LLM_CONFIG at once when the key is rejected, without retrying', async () => {
    const model = scriptedModel(apiError(401))
    worker = await startTestWorker(model)
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const { cv, seen } = await watchCv(app.server(), cookie, created.id)
    expect(seen).not.toContain('retrying 1')
    expect(cv).toMatchObject({
      status: 'failed',
      attempt: 1,
      errorCode: 'LLM_CONFIG',
      error: 'The AI service is not configured on the server.',
    })
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(await attempts()).toEqual([
      [1, 'failed', expect.stringMatching(/^AI_APICallError: Anthropic answered 401/)],
    ])
  })

  it('retries a model that never submits a draft, then fails with LLM_INVALID_OUTPUT', async () => {
    const answer = () => textStep('Here is your CV: ...')
    worker = await startTestWorker(scriptedModel(answer(), answer(), answer()))
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const { cv, seen } = await watchCv(app.server(), cookie, created.id)
    expect(seen).toContain('retrying 1')
    expect(cv).toMatchObject({
      status: 'failed',
      attempt: 3,
      stage: null,
      errorCode: 'LLM_INVALID_OUTPUT',
      error: 'The AI returned an unusable draft several times. Try again.',
      data: null,
    })
    const invalid = 'NoValidSubmissionError: no schema-valid submit_draft in 1 agent steps'
    expect(await attempts()).toEqual([
      [1, 'failed', invalid],
      [2, 'failed', invalid],
      [3, 'failed', invalid],
    ])
  })

  it('aborts a model that hangs and fails with TIMEOUT once the attempts are used', async () => {
    worker = await startTestWorker(hangingModel(), { agent: { stepMs: 200, totalMs: 1_000 } })
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const { cv, seen } = await watchCv(app.server(), cookie, created.id)
    expect(seen).toContain('retrying 1')
    expect(cv).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorCode: 'TIMEOUT',
      error: 'Generation took too long. Try again.',
    })
    expect(await attempts()).toEqual([
      [1, 'failed', expect.stringMatching(/^TimeoutError: /)],
      [2, 'failed', expect.stringMatching(/^TimeoutError: /)],
      [3, 'failed', expect.stringMatching(/^TimeoutError: /)],
    ])
  })

  describe('manual Retry', () => {
    it('queues a failed CV again from attempt 1 as a new job, which produces the draft', async () => {
      worker = await startTestWorker(scriptedModel(apiError(401), submitStep(completeSubmission())))
      const { cookie } = await signUp(app.server())
      const created = await createCv(app.server(), cookie)
      expect((await waitForCv(app.server(), cookie, created.id)).status).toBe('failed')

      const response = await request(app.server())
        .post(`/api/cvs/${created.id}/retry`)
        .set('Cookie', cookie)
      expect(response.status).toBe(202)
      expect(cvResponseSchema.parse(response.body).cv).toMatchObject({
        id: created.id,
        status: 'queued',
        attempt: 1,
        errorCode: null,
        error: null,
      })

      const cv = await waitForCv(app.server(), cookie, created.id)
      expect(cv).toMatchObject({ status: 'ready', attempt: 1, version: 1 })
      const jobs = await db.select().from(generationJobs).orderBy(generationJobs.createdAt)
      expect(jobs).toHaveLength(2)
      const rows = await db.select().from(generationAttempts).orderBy(generationAttempts.createdAt)
      expect(rows.map((row) => [row.jobId, row.attempt, row.status])).toEqual([
        [jobs[0]?.id, 1, 'failed'],
        [jobs[1]?.id, 1, 'succeeded'],
      ])
    })

    it('never runs the job a Retry replaced', async () => {
      const { cookie } = await signUp(app.server())
      // no worker yet: the first job stays on the queue while the CV fails and is retried
      const created = await createCv(app.server(), cookie)
      const statuses = app.app.get(CvStatusService)
      await statuses.transition(created.id, 'generating')
      await statuses.transition(created.id, 'failed', { changes: { errorCode: 'TIMEOUT' } })
      const retried = await request(app.server())
        .post(`/api/cvs/${created.id}/retry`)
        .set('Cookie', cookie)
      expect(retried.status).toBe(202)

      const model = scriptedModel(submitStep(completeSubmission()))
      worker = await startTestWorker(model)
      expect((await waitForCv(app.server(), cookie, created.id)).status).toBe('ready')
      const [, latest] = await db.select().from(generationJobs).orderBy(generationJobs.createdAt)
      const rows = await db.select().from(generationAttempts)
      expect(rows.map((row) => row.jobId)).toEqual([latest?.id])
      expect(model.doGenerateCalls).toHaveLength(1)
    })

    it('is only for a failed CV of the caller, and counts toward the CVs in progress', async () => {
      const owner = await signUp(app.server())
      const stranger = await signUp(app.server(), 'bob@example.com')
      const statuses = app.app.get(CvStatusService)
      // no worker: the CVs stay where the test puts them
      const failed = await createCv(app.server(), owner.cookie)
      await statuses.transition(failed.id, 'generating')
      await statuses.transition(failed.id, 'failed', { changes: { errorCode: 'LLM_CONFIG' } })
      const queued = await createCv(app.server(), owner.cookie)
      const retry = (id: string, cookie: string) =>
        request(app.server()).post(`/api/cvs/${id}/retry`).set('Cookie', cookie)

      const notFailed = await retry(queued.id, owner.cookie)
      expect(notFailed.status).toBe(409)
      expect(errorResponseSchema.parse(notFailed.body).error.code).toBe('INVALID_STATE')

      const foreign = await retry(failed.id, stranger.cookie)
      expect(foreign.status).toBe(404)
      expect(errorResponseSchema.parse(foreign.body).error.code).toBe('NOT_FOUND')

      // `queued` is in progress already; the others fill the user's limit
      for (let i = 1; i < TEST_LIMITS.activePerUser; i++) await createCv(app.server(), owner.cookie)
      const busy = await retry(failed.id, owner.cookie)
      expect(busy.status).toBe(429)
      expect(errorResponseSchema.parse(busy.body).error.code).toBe('TOO_MANY_ACTIVE')
      expect(await db.select().from(generationJobs)).toHaveLength(1 + TEST_LIMITS.activePerUser)
    })
  })

  describe('queue recovery', () => {
    it('puts a queued CV back on the queue at worker start after Redis lost its job', async () => {
      const { cookie } = await signUp(app.server())
      const created = await createCv(app.server(), cookie)
      const redis = app.app.get<Redis>(REDIS)
      await redis.del(...(await redis.keys(`${TEST_QUEUE_PREFIX}:*`)))

      worker = await startTestWorker(scriptedModel(submitStep(completeSubmission())))
      expect((await waitForCv(app.server(), cookie, created.id)).status).toBe('ready')
    })

    it('fails a generating CV whose job BullMQ gave up on, instead of running it again', async () => {
      const { cookie } = await signUp(app.server())
      const created = await createCv(app.server(), cookie)
      const [job] = await db.select().from(generationJobs)
      const jobId = job?.id ?? ''
      // a worker took the job, opened an attempt and died too often: BullMQ failed the job
      await app.app.get(CvStatusService).transition(created.id, 'generating')
      await db
        .insert(generationAttempts)
        .values({ jobId, attempt: 1, model: 'scripted', promptVersion: 'old' })
      const env = testEnv()
      const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
      const failing = new Worker(
        GENERATION_QUEUE_NAME,
        async () => {
          throw new UnrecoverableError('stalled more than allowable limit')
        },
        { connection, prefix: env.QUEUE_PREFIX },
      )
      const queue = new Queue(GENERATION_QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX })
      await waitUntil(async () => (await queue.getJobState(jobId)) === 'failed')
      await failing.close()

      const model = scriptedModel()
      worker = await startTestWorker(model)
      const cv = await waitForCv(app.server(), cookie, created.id)
      expect(cv).toMatchObject({ status: 'failed', errorCode: 'INTERNAL' })
      expect(await attempts()).toEqual([[1, 'failed', 'stalled']])
      expect(model.doGenerateCalls).toHaveLength(0)
      await queue.close()
      connection.disconnect()
    })

    it('finds a CV whose job never reached the queue on a periodic pass', async () => {
      const { id: userId, cookie } = await signUp(app.server())
      worker = await startTestWorker(scriptedModel(submitStep(completeSubmission())), {
        recoveryMs: 200,
      })
      // as if the api committed the CV and its job, then failed to add the job to Redis
      const [cv] = await db
        .insert(cvs)
        .values({
          userId,
          title: 'Backend Engineer',
          targetRole: 'Backend Engineer',
          sourceType: 'text',
          sourceText: SOURCE_TEXT,
          status: 'queued',
        })
        .returning()
      await db.insert(generationJobs).values({ cvId: cv?.id, userId })

      expect((await waitForCv(app.server(), cookie, cv?.id ?? '')).status).toBe('ready')
    })
  })
})

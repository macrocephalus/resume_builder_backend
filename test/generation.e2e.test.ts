import { cvListResponseSchema } from '@cv/shared'
import { MockLanguageModelV4 } from 'ai/test'
import { isNotNull } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PROMPT_VERSION } from '../src/agents/prompt/prompt-builder'
import { CvStatusService } from '../src/cvs/cv-status.service'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvQuestions, cvs, generationAttempts, generationJobs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { SOURCE_TEXT, createCv } from './helpers/cvs'
import { completeSubmission, scriptedModel, submitStep, textStep } from './helpers/model'
import { type TestWorker, startTestWorker, waitForCv, waitUntil } from './helpers/worker'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generation, happy path (scripted model)', () => {
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

  const attempts = () => db.select().from(generationAttempts)

  it('turns a queued CV into needs_input with the auto questions and the model question', async () => {
    const submission = completeSubmission()
    submission.cv.contacts.email = null
    submission.questions = [
      {
        kind: 'choice',
        text: 'What is your level of English?',
        label: 'English',
        options: ['B2', 'C1'],
        target: { section: 'languages', itemIndex: 0, field: 'level' },
      },
    ]
    const model = scriptedModel(submitStep(submission, 300))
    worker = await startTestWorker(model)
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie, { language: 'uk' })

    const cv = await waitForCv(app.server(), cookie, created.id)
    expect(cv).toMatchObject({
      status: 'needs_input',
      stage: null,
      attempt: 1,
      version: 1,
      errorCode: null,
      suggestedRoles: ['Node.js Tech Lead'],
      verification: { verified: 2, sentToConfirm: 0, skillsToConfirm: 0, cleared: 0 },
    })
    expect(cv.data?.experience[0]).toMatchObject({
      id: expect.stringMatching(UUID),
      company: 'Fintory',
    })
    expect(cv.requirements.map((item) => [item.label, item.id])).toEqual([
      ['Node.js', expect.stringMatching(UUID)],
      ['Kubernetes', expect.stringMatching(UUID)],
    ])
    expect(cv.questions.map((q) => [q.origin, q.kind, q.target])).toEqual([
      ['auto', 'text', { section: 'contacts', field: 'email' }],
      ['auto', 'text', { section: 'contacts', field: 'phone' }],
      [
        'model',
        'choice',
        { section: 'languages', itemId: cv.data?.languages[0]?.id, field: 'level' },
      ],
    ])
    expect(cv.questions.every((q) => q.status === 'open')).toBe(true)

    // the model got the CV's data in the user message, the language by its English name
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(prompt).toContain('<target_role>Senior Backend Engineer</target_role>')
    expect(prompt).toContain('<cv_language>Ukrainian</cv_language>')
    expect(prompt).toContain(JSON.stringify(SOURCE_TEXT).slice(1, 40))

    expect(await attempts()).toEqual([
      expect.objectContaining({
        attempt: 1,
        status: 'succeeded',
        model: 'scripted',
        promptVersion: PROMPT_VERSION,
        agentSteps: 1,
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 300,
        finishedAt: expect.any(Date),
        error: null,
      }),
    ])
  })

  it('ends ready for a complete draft, and the list shows its match', async () => {
    worker = await startTestWorker(scriptedModel(submitStep(completeSubmission())))
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const cv = await waitForCv(app.server(), cookie, created.id)
    expect(cv).toMatchObject({ status: 'ready', questions: [], version: 1 })
    expect(cv.data?.summary).toBe(completeSubmission().cv.summary)

    const list = cvListResponseSchema.parse(
      (await request(app.server()).get('/api/cvs').set('Cookie', cookie)).body,
    )
    expect(list.items[0]).toMatchObject({
      status: 'ready',
      openQuestions: 0,
      match: { covered: 1, total: 2 },
    })
  })

  it('shows the drafting stage while the model writes', async () => {
    const stages: Array<string | null> = []
    const model = new MockLanguageModelV4({
      modelId: 'scripted',
      doGenerate: async () => {
        const [row] = await db.select({ stage: cvs.stage }).from(cvs)
        stages.push(row?.stage ?? null)
        return submitStep(completeSubmission())
      },
    })
    worker = await startTestWorker(model)
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)
    await waitForCv(app.server(), cookie, created.id)
    expect(stages).toEqual(['drafting'])
  })

  it('fails the CV with LLM_INVALID_OUTPUT when the model never submits a valid draft', async () => {
    worker = await startTestWorker(scriptedModel(textStep('Here is your CV: ...')))
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)

    const cv = await waitForCv(app.server(), cookie, created.id)
    expect(cv).toMatchObject({
      status: 'failed',
      stage: null,
      errorCode: 'LLM_INVALID_OUTPUT',
      error: 'The AI returned an unusable draft several times. Try again.',
      data: null,
    })
    expect(await attempts()).toEqual([
      expect.objectContaining({ status: 'failed', agentSteps: 1, error: 'no valid submission' }),
    ])
  })

  it('leaves no trace of a CV deleted during the attempt, and keeps its job row', async () => {
    const { cookie } = await signUp(app.server())
    let cvId = ''
    const model = new MockLanguageModelV4({
      modelId: 'scripted',
      doGenerate: async () => {
        // the user deletes the CV while the model writes
        const deleted = await request(app.server()).delete(`/api/cvs/${cvId}`).set('Cookie', cookie)
        expect(deleted.status).toBe(204)
        return submitStep({ ...completeSubmission(), questions: [] })
      },
    })
    worker = await startTestWorker(model)
    cvId = (await createCv(app.server(), cookie)).id

    await waitUntil(
      async () =>
        (await db.select().from(generationAttempts).where(isNotNull(generationAttempts.finishedAt)))
          .length > 0,
    )
    expect(await db.select().from(cvs)).toEqual([])
    expect(await db.select().from(cvQuestions)).toEqual([])
    expect(await db.select().from(generationJobs)).toEqual([
      expect.objectContaining({ cvId: null }),
    ])
    expect(await attempts()).toEqual([
      expect.objectContaining({ status: 'failed', error: 'discarded: the CV moved on' }),
    ])
  })

  it('takes over a CV left generating by a stalled attempt of the same job', async () => {
    const { cookie } = await signUp(app.server())
    const created = await createCv(app.server(), cookie)
    // a worker died mid-attempt: the CV is generating and its attempt row is still running
    const [job] = await db.select().from(generationJobs)
    await app.app.get(CvStatusService).transition(created.id, 'generating', {
      changes: { stage: 'revising' },
    })
    await db
      .insert(generationAttempts)
      .values({ jobId: job?.id ?? '', attempt: 1, model: 'scripted', promptVersion: 'old' })

    worker = await startTestWorker(scriptedModel(submitStep(completeSubmission())))
    const cv = await waitForCv(app.server(), cookie, created.id)
    expect(cv.status).toBe('ready')
    expect((await attempts()).map((row) => [row.status, row.error])).toEqual(
      expect.arrayContaining([
        ['failed', 'stalled'],
        ['succeeded', null],
      ]),
    )
  })
})

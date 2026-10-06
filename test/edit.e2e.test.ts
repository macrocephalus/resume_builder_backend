import {
  type CvData,
  cvListResponseSchema,
  cvResponseSchema,
  errorResponseSchema,
} from '@cv/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE, type Database } from '../src/database/database.module'
import { JSON_BODY } from '../src/config/limits'
import { cvs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { createCv } from './helpers/cvs'
import { JOB, draft, fullDraft, needsInput, question } from './helpers/draft'

const SCHOOL = '22222222-2222-4222-8222-222222222222'

const PHONE = question('text', { section: 'contacts', field: 'phone' })
const COMPANY = question('text', { section: 'experience', itemId: JOB, field: 'company' })
const CONFIRM = question(
  'confirm',
  { section: 'experience', itemId: JOB, field: 'bullets' },
  { claim: 'Led a team of 12 engineers' },
)

describe('PATCH /api/cvs/:id', () => {
  let app: TestApp
  let db: Database

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
  })

  afterAll(() => app.close())

  const patch = (cookie: string, id: string, body: object) =>
    request(app.server()).patch(`/api/cvs/${id}`).set('Cookie', cookie).send(body)

  const cvOf = (response: request.Response) => {
    expect(response.status).toBe(200)
    return cvResponseSchema.parse(response.body).cv
  }

  const errorOf = (response: request.Response, status: number) => {
    expect(response.status).toBe(status)
    return errorResponseSchema.parse(response.body).error
  }

  const stored = async (id: string) => (await db.select().from(cvs).where(eq(cvs.id, id)))[0]

  it('renames the CV, moves the version and puts it first in the list', async () => {
    const { cookie, id } = await needsInput(app)
    const newer = await createCv(app.server(), cookie)

    const cv = cvOf(await patch(cookie, id, { version: 1, title: '  Olena — Backend ' }))
    expect(cv).toMatchObject({ title: 'Olena — Backend', version: 2, data: draft() })

    const list = cvListResponseSchema.parse(
      (await request(app.server()).get('/api/cvs').set('Cookie', cookie)).body,
    )
    expect(list.items.map((item) => item.id)).toEqual([id, newer.id])
  })

  it('replaces the whole draft, the section order too, without empty items and blank values', async () => {
    const { cookie, id } = await needsInput(app)
    const edited: CvData = {
      ...draft(),
      summary: 'Payments engineer.',
      skills: ['PostgreSQL', ' ', 'Go'],
      education: [{ id: SCHOOL, institution: ' ', degree: null, period: null }],
      sectionOrder: [
        'experience',
        'summary',
        'skills',
        'projects',
        'education',
        'certifications',
        'languages',
      ],
    }

    const cv = cvOf(await patch(cookie, id, { version: 1, data: edited }))
    expect(cv.version).toBe(2)
    expect(cv.data).toEqual({ ...edited, skills: ['PostgreSQL', 'Go'], education: [] })
    expect((await stored(id))?.data).toEqual(cv.data)
  })

  it('refuses a stale version with 409 VERSION_CONFLICT and the current one, writing nothing', async () => {
    const { cookie, id } = await needsInput(app)
    cvOf(await patch(cookie, id, { version: 1, title: 'First tab' }))

    const error = errorOf(await patch(cookie, id, { version: 1, title: 'Second tab' }), 409)
    expect(error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } })
    expect(await stored(id)).toMatchObject({ title: 'First tab', version: 2, data: draft() })
  })

  it('skips the questions about a removed item and makes the CV ready when none is left', async () => {
    const { cookie, id, questionIds } = await needsInput(app, COMPANY, CONFIRM)
    const cv = cvOf(await patch(cookie, id, { version: 1, data: { ...draft(), experience: [] } }))
    expect(cv).toMatchObject({ status: 'ready', version: 2 })
    expect(cv.questions.map((q) => [q.id, q.status])).toEqual([
      [questionIds[0], 'skipped'],
      [questionIds[1], 'skipped'],
    ])
  })

  it('stays needs_input while a question about a kept part is still open', async () => {
    const { cookie, id, questionIds } = await needsInput(app, COMPANY, PHONE)
    const cv = cvOf(await patch(cookie, id, { version: 1, data: { ...draft(), experience: [] } }))
    expect(cv.status).toBe('needs_input')
    expect(cv.questions.map((q) => [q.id, q.status])).toEqual([
      [questionIds[1], 'open'],
      [questionIds[0], 'skipped'],
    ])
  })

  it('saves a draft with every field at its limit', async () => {
    const { cookie, id } = await needsInput(app)
    const data = fullDraft()
    const cv = cvOf(await patch(cookie, id, { version: 1, data }))
    expect(cv.data).toEqual(data)
  })

  it('is 413 INPUT_TOO_LARGE for a body over the JSON limit', async () => {
    const { cookie, id } = await needsInput(app)
    const summary = 'x'.repeat(JSON_BODY.bytes)
    const error = errorOf(
      await patch(cookie, id, { version: 1, data: { ...draft(), summary } }),
      413,
    )
    expect(error.code).toBe('INPUT_TOO_LARGE')
  })

  it('saves a title and a draft together as one version', async () => {
    const { cookie, id } = await needsInput(app)
    const data = { ...draft(), summary: 'Payments engineer.' }
    const cv = cvOf(await patch(cookie, id, { version: 1, title: 'Both', data }))
    expect(cv).toMatchObject({ title: 'Both', version: 2, data })
  })

  it('refuses a stale draft and keeps the newer one', async () => {
    const { cookie, id, questionIds } = await needsInput(app, COMPANY)
    const newer = { ...draft(), summary: 'Saved in the first tab.' }
    cvOf(await patch(cookie, id, { version: 1, data: newer }))

    const stale = { ...draft(), experience: [] }
    const error = errorOf(await patch(cookie, id, { version: 1, data: stale }), 409)
    expect(error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } })
    expect(await stored(id)).toMatchObject({ version: 2, data: newer, status: 'needs_input' })
    const [question] = cvOf(
      await request(app.server()).get(`/api/cvs/${id}`).set('Cookie', cookie),
    ).questions
    expect(question).toMatchObject({ id: questionIds[0], status: 'open' })
  })

  it('leaves the question about a field filled by hand open', async () => {
    const { cookie, id } = await needsInput(app, PHONE, COMPANY)
    const filled = draft()
    filled.contacts.phone = '+380 67 123'
    const cv = cvOf(await patch(cookie, id, { version: 1, data: filled }))
    expect(cv.status).toBe('needs_input')
    expect(cv.questions.map((q) => q.status)).toEqual(['open', 'open'])
    expect(cv.data?.contacts.phone).toBe('+380 67 123')
  })

  it('is 400 VALIDATION_ERROR for duplicate item ids, a bad title or neither title nor draft', async () => {
    const { cookie, id } = await needsInput(app)
    const job = draft().experience[0]
    const project = { id: JOB, name: 'Ledger', period: null, url: null, bullets: [] }
    const duplicate = { ...draft(), projects: [project] }
    const bad = [
      { version: 1, data: duplicate },
      { version: 1, data: { ...draft(), experience: [{ ...job, id: 'not-a-uuid' }] } },
      { version: 1, title: ' ' },
      { version: 1, title: 'x'.repeat(121) },
      { version: 1 },
      { title: 'No version' },
    ]
    for (const body of bad)
      expect(errorOf(await patch(cookie, id, body), 400).code).toBe('VALIDATION_ERROR')
    expect(await stored(id)).toMatchObject({ version: 1, data: draft() })
  })

  it('is 409 INVALID_STATE for a CV that is not needs_input or ready', async () => {
    const { cookie, id } = await needsInput(app)
    await db.update(cvs).set({ status: 'queued' }).where(eq(cvs.id, id))
    expect(errorOf(await patch(cookie, id, { version: 1, title: 'Too early' }), 409).code).toBe(
      'INVALID_STATE',
    )
    expect(await stored(id)).toMatchObject({ version: 1 })
  })

  it('edits a ready CV too', async () => {
    const { cookie, id } = await needsInput(app)
    await db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))
    expect(cvOf(await patch(cookie, id, { version: 1, title: 'Ready' }))).toMatchObject({
      status: 'ready',
      version: 2,
    })
  })
})

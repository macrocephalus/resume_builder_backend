import { errorResponseSchema, usageResponseSchema } from '@cv/shared'
import { eq, sql } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs, generationJobs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { createCv, newCvBody } from './helpers/cvs'
import { TEST_LIMITS } from './helpers/env'

const HOUR = 3_600_000

describe('usage and the hourly generation limit', () => {
  let app: TestApp
  let db: Database

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
  })

  afterAll(() => app.close())

  const usage = async (cookie: string) => {
    const response = await request(app.server()).get('/api/usage').set('Cookie', cookie)
    expect(response.status).toBe(200)
    return usageResponseSchema.parse(response.body)
  }

  const create = (cookie: string) =>
    request(app.server()).post('/api/cvs').set('Cookie', cookie).send(newCvBody())

  /** Out of progress, so only the hourly limit can refuse the next start. */
  const finish = (id: string) => db.update(cvs).set({ status: 'ready' }).where(eq(cvs.id, id))

  /** Starts `count` generations, each CV finished at once. */
  const startFinished = async (cookie: string, count: number) => {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const { id } = await createCv(app.server(), cookie)
      await finish(id)
      ids.push(id)
    }
    return ids
  }

  it('needs a session', async () => {
    expect((await request(app.server()).get('/api/usage')).status).toBe(401)
  })

  it('starts at zero, the next generation an hour away', async () => {
    const { cookie } = await signUp(app.server())
    const before = Date.now()
    const { generations, active } = await usage(cookie)
    expect(generations).toMatchObject({ used: 0, limit: TEST_LIMITS.perHour })
    expect(Date.parse(generations.resetsAt) - before).toBeGreaterThan(HOUR - 5_000)
    expect(Date.parse(generations.resetsAt) - before).toBeLessThan(HOUR + 5_000)
    expect(active).toEqual({ used: 0, limit: TEST_LIMITS.activePerUser })
  })

  it('counts creates and a Retry, keeps counting a deleted CV, and frees active on ready', async () => {
    const { cookie } = await signUp(app.server())
    const first = await createCv(app.server(), cookie)
    const second = await createCv(app.server(), cookie)
    expect(await usage(cookie)).toMatchObject({ generations: { used: 2 }, active: { used: 2 } })

    await db
      .update(cvs)
      .set({ status: 'failed', errorCode: 'INTERNAL' })
      .where(eq(cvs.id, first.id))
    expect(
      (await request(app.server()).post(`/api/cvs/${first.id}/retry`).set('Cookie', cookie)).status,
    ).toBe(202)
    expect(await usage(cookie)).toMatchObject({ generations: { used: 3 }, active: { used: 2 } })

    await finish(second.id)
    expect((await usage(cookie)).active.used).toBe(1)
    expect(
      (await request(app.server()).delete(`/api/cvs/${second.id}`).set('Cookie', cookie)).status,
    ).toBe(204)
    expect(await usage(cookie)).toMatchObject({ generations: { used: 3 }, active: { used: 1 } })
  })

  it('refuses a start over the hourly limit with 429 RATE_LIMITED and Retry-After at resetsAt', async () => {
    const { cookie } = await signUp(app.server())
    const [oldest] = await startFinished(cookie, TEST_LIMITS.perHour)
    // the oldest start was 40 minutes ago: one frees up in 20
    await db
      .update(generationJobs)
      .set({ createdAt: sql`now() - interval '40 minutes'` })
      .where(eq(generationJobs.cvId, oldest ?? ''))
    const { generations } = await usage(cookie)
    expect(generations.used).toBe(TEST_LIMITS.perHour)

    const refused = await create(cookie)
    expect(refused.status).toBe(429)
    expect(errorResponseSchema.parse(refused.body).error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { limit: TEST_LIMITS.perHour },
    })
    const retryAfter = Number(refused.headers['retry-after'])
    const untilReset = (Date.parse(generations.resetsAt) - Date.now()) / 1000
    expect(Math.abs(retryAfter - untilReset)).toBeLessThan(3)
    expect(retryAfter).toBeGreaterThan(19 * 60)
    expect(await db.select().from(generationJobs)).toHaveLength(TEST_LIMITS.perHour)
  })

  it('refuses a Retry over the hourly limit too, and leaves the CV failed', async () => {
    const { cookie } = await signUp(app.server())
    const [failed] = await startFinished(cookie, TEST_LIMITS.perHour)
    await db
      .update(cvs)
      .set({ status: 'failed', errorCode: 'INTERNAL' })
      .where(eq(cvs.id, failed ?? ''))
    const refused = await request(app.server())
      .post(`/api/cvs/${failed}/retry`)
      .set('Cookie', cookie)
    expect(refused.status).toBe(429)
    expect(errorResponseSchema.parse(refused.body).error.code).toBe('RATE_LIMITED')
    const [row] = await db
      .select()
      .from(cvs)
      .where(eq(cvs.id, failed ?? ''))
    expect(row?.status).toBe('failed')
  })

  it('lets one of several starts at the same moment take the last generation of the hour', async () => {
    const { cookie } = await signUp(app.server())
    await startFinished(cookie, TEST_LIMITS.perHour - 1)
    const responses = await Promise.all(Array.from({ length: 6 }, () => create(cookie)))
    expect(responses.map((response) => response.status).sort()).toEqual([
      202, 429, 429, 429, 429, 429,
    ])
    expect(await db.select().from(generationJobs)).toHaveLength(TEST_LIMITS.perHour)
  })

  it('checks the hourly limit before the active one', async () => {
    const { cookie } = await signUp(app.server())
    await startFinished(cookie, TEST_LIMITS.perHour - TEST_LIMITS.activePerUser)
    for (let i = 0; i < TEST_LIMITS.activePerUser; i++) await createCv(app.server(), cookie)
    const refused = await create(cookie)
    expect(errorResponseSchema.parse(refused.body).error.code).toBe('RATE_LIMITED')
  })

  it('lets a start through again once the oldest one leaves the window', async () => {
    const { cookie } = await signUp(app.server())
    const [oldest] = await startFinished(cookie, TEST_LIMITS.perHour)
    expect((await create(cookie)).status).toBe(429)
    await db
      .update(generationJobs)
      .set({ createdAt: sql`now() - interval '61 minutes'` })
      .where(eq(generationJobs.cvId, oldest ?? ''))
    expect((await usage(cookie)).generations.used).toBe(TEST_LIMITS.perHour - 1)
    expect((await create(cookie)).status).toBe(202)
  })
})

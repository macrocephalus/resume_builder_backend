import { errorResponseSchema } from '@cv/shared'
import { eq, sql } from 'drizzle-orm'
import request from 'supertest'
import { extractText } from 'unpdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { needsInput } from './helpers/draft'

describe('GET /api/cvs/:id/pdf', () => {
  let app: TestApp
  let db: Database

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
  })

  afterAll(() => app.close())

  /** The response with its body as raw bytes, whatever its type. */
  const download = (cookie: string, id: string) =>
    request(app.server())
      .get(`/api/cvs/${id}/pdf`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => done(null, Buffer.concat(chunks)))
      })

  /** The error code of a JSON error answered to a raw-bytes request. */
  const errorCodeOf = (response: request.Response) => {
    const body: unknown = JSON.parse(z.instanceof(Buffer).parse(response.body).toString())
    return errorResponseSchema.parse(body).error.code
  }

  it('sends a ready CV as an A4 PDF named after its title, drawn from the saved draft', async () => {
    const { cookie, id } = await needsInput(app)
    await db.update(cvs).set({ status: 'ready', title: 'Олена — Backend' }).where(eq(cvs.id, id))

    const response = await download(cookie, id)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="Backend.pdf"; filename*=UTF-8\'\'%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0%20%E2%80%94%20Backend.pdf',
    )
    const body = z.instanceof(Buffer).parse(response.body)
    const { text } = await extractText(new Uint8Array(body), { mergePages: true })
    expect(text).toContain('Olena Hnatiuk')
    expect(text).toContain('Built the payments API')
  })

  it('sends a CV that still waits for answers too', async () => {
    const { cookie, id } = await needsInput(app)
    expect((await download(cookie, id)).status).toBe(200)
  })

  it('is 409 INVALID_STATE before the draft exists', async () => {
    const { cookie, id } = await needsInput(app)
    await db.update(cvs).set({ status: 'queued', data: null }).where(eq(cvs.id, id))
    const response = await download(cookie, id)
    expect(response.status).toBe(409)
    expect(errorCodeOf(response)).toBe('INVALID_STATE')
  })

  it('is 500 DATA_CORRUPT for a stored draft that is no CvData, here and on GET', async () => {
    const { cookie, id } = await needsInput(app)
    // what no write of the app can store: a draft without its blocks
    await db
      .update(cvs)
      .set({ data: sql`'{"contacts": {}}'::jsonb` })
      .where(eq(cvs.id, id))
    const response = await download(cookie, id)
    expect(response.status).toBe(500)
    expect(response.headers['content-type']).toMatch(/^application\/json/)
    expect(errorCodeOf(response)).toBe('DATA_CORRUPT')

    const get = await request(app.server()).get(`/api/cvs/${id}`).set('Cookie', cookie)
    expect(get.status).toBe(500)
    expect(errorResponseSchema.parse(get.body).error.code).toBe('DATA_CORRUPT')
  })
})

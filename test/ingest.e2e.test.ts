import { errorResponseSchema, ingestPdfResponseSchema } from '@cv/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { buildPdf, textPage } from './helpers/pdf'

const TWO_PAGES = buildPdf([textPage('Olena Hnatiuk'), textPage('Experience')])

const upload = (app: TestApp, cookie: string, file: Buffer, filename = 'olena-cv.pdf') =>
  request(app.server()).post('/api/ingest/pdf').set('Cookie', cookie).attach('file', file, filename)

const expectError = (response: request.Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  expect(errorResponseSchema.parse(response.body).error.code).toBe(code)
}

describe('POST /api/ingest/pdf', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(() => app.close())

  /** A fresh user's session cookie (tables are emptied before every test). */
  const signedIn = async () => (await signUp(app.server())).cookie

  it('needs a session', async () => {
    const response = await request(app.server())
      .post('/api/ingest/pdf')
      .attach('file', TWO_PAGES, 'cv.pdf')
    expectError(response, 401, 'UNAUTHORIZED')
  })

  it('returns the text of every page, the page and character counts and the filename', async () => {
    const cookie = await signedIn()
    const response = await upload(app, cookie, TWO_PAGES)

    expect(response.status).toBe(200)
    const body = ingestPdfResponseSchema.parse(response.body)
    expect(body).toEqual({
      text: body.text,
      pages: 2,
      chars: body.text.length,
      filename: 'olena-cv.pdf',
    })
    expect(body.text).toContain('Olena Hnatiuk')
    expect(body.text).toContain('Experience')
    expect(body.text.indexOf('Olena Hnatiuk')).toBeLessThan(body.text.indexOf('Experience'))
  })

  it('checks the content, not the name: a PDF named .txt is read, a text file named .pdf is not', async () => {
    const cookie = await signedIn()
    expect((await upload(app, cookie, TWO_PAGES, 'cv.txt')).status).toBe(200)

    const renamed = Buffer.from(
      'Olena Hnatiuk\nBackend engineer, eight years of Node.js.\n'.repeat(3),
    )
    expectError(await upload(app, cookie, renamed, 'cv.pdf'), 415, 'UNSUPPORTED_FILE')
  })

  it('echoes a Cyrillic filename intact and cuts a long one to 200 characters', async () => {
    const cookie = await signedIn()
    const cyrillic = ingestPdfResponseSchema.parse(
      (await upload(app, cookie, TWO_PAGES, 'Резюме Олени.pdf')).body,
    )
    expect(cyrillic.filename).toBe('Резюме Олени.pdf')

    const long = ingestPdfResponseSchema.parse(
      (await upload(app, cookie, TWO_PAGES, `${'a'.repeat(300)}.pdf`)).body,
    )
    expect(long.filename).toBe('a'.repeat(200))
  })

  it('rejects a file over 5 MB with 413 INPUT_TOO_LARGE before reading it', async () => {
    const cookie = await signedIn()
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)])
    expectError(await upload(app, cookie, huge), 413, 'INPUT_TOO_LARGE')
  })

  it('rejects a PDF over 10 pages with 413 INPUT_TOO_LARGE', async () => {
    const cookie = await signedIn()
    const eleven = buildPdf(Array.from({ length: 11 }, (_, i) => textPage(`Page ${i + 1}`)))
    expectError(await upload(app, cookie, eleven), 413, 'INPUT_TOO_LARGE')

    const ten = buildPdf(Array.from({ length: 10 }, (_, i) => textPage(`Page ${i + 1}`)))
    expect((await upload(app, cookie, ten)).status).toBe(200)
  })

  it('rejects a scan, a broken PDF and one with under 50 characters with 422 PDF_UNREADABLE', async () => {
    const cookie = await signedIn()
    const scan = buildPdf([{ image: true }, { image: true }])
    const broken = Buffer.from('%PDF-1.7\nthis is not a pdf body at all')
    const short = buildPdf([{ lines: ['Olena Hnatiuk', 'Kyiv'] }])

    for (const file of [scan, broken, short]) {
      expectError(await upload(app, cookie, file), 422, 'PDF_UNREADABLE')
    }
  })

  it('is 400 VALIDATION_ERROR naming the field without a file', async () => {
    const cookie = await signedIn()
    const response = await request(app.server()).post('/api/ingest/pdf').set('Cookie', cookie)
    expectError(response, 400, 'VALIDATION_ERROR')
    const { fields } = z
      .object({ fields: z.record(z.string(), z.string()) })
      .parse(errorResponseSchema.parse(response.body).error.details)
    expect(Object.keys(fields)).toEqual(['file'])
  })

  it('takes the file part only: an extra field is 400, so nothing but the file fills the body', async () => {
    const cookie = await signedIn()
    const response = await upload(app, cookie, TWO_PAGES).field('note', 'x'.repeat(1000))
    expectError(response, 400, 'VALIDATION_ERROR')
  })

  it('is throttled at 20 uploads a minute per user, not per IP', async () => {
    // its own app: the throttler counts in memory, per api instance
    const fresh = await createTestApp()
    try {
      const ann = await signUp(fresh.server(), 'ann@example.com')
      const bob = await signUp(fresh.server(), 'bob@example.com')
      for (let attempt = 1; attempt <= 20; attempt++) {
        expect((await upload(fresh, ann.cookie, TWO_PAGES)).status).toBe(200)
      }
      const blocked = await upload(fresh, ann.cookie, TWO_PAGES)
      expectError(blocked, 429, 'RATE_LIMITED')
      expect(errorResponseSchema.parse(blocked.body).error.details).toEqual({ limit: 20 })
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)

      // the same IP, another user
      expect((await upload(fresh, bob.cookie, TWO_PAGES)).status).toBe(200)
    } finally {
      await fresh.close()
    }
  })
})

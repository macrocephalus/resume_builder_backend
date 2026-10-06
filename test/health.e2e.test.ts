import { errorResponseSchema } from '@cv/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type TestApp, createTestApp } from './helpers/app'

describe('the api skeleton', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(() => app.close())

  it('GET /api/health answers ok while the database answers', async () => {
    const response = await request(app.server()).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })

  it('an unknown route is 404 NOT_FOUND in the error shape', async () => {
    const response = await request(app.server()).get('/api/nowhere')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: {} },
    })
    expect(errorResponseSchema.safeParse(response.body).success).toBe(true)
  })

  it('a body that is not JSON is 400 VALIDATION_ERROR, not a stack trace', async () => {
    const response = await request(app.server())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"status": ')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details).toEqual({})
  })

  it('every response carries a request id, kept from x-request-id when sent', async () => {
    const own = await request(app.server()).get('/api/health').set('x-request-id', 'req-123')
    expect(own.headers['x-request-id']).toBe('req-123')
    const generated = await request(app.server()).get('/api/health')
    expect(generated.headers['x-request-id']).toMatch(/\S+/)
  })
})

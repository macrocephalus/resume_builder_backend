import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type TestApp, createTestApp } from './helpers/app'

/** Every route of docs/api.md "Endpoint summary", as OpenAPI writes it, and whether it is public. */
const ENDPOINTS = [
  ['get', '/api/health', 'public'],
  ['post', '/api/auth/signup', 'public'],
  ['post', '/api/auth/login', 'public'],
  ['post', '/api/auth/logout', 'public'],
  ['get', '/api/auth/me', 'session'],
  ['get', '/api/usage', 'session'],
  ['post', '/api/ingest/pdf', 'session'],
  ['post', '/api/cvs', 'session'],
  ['get', '/api/cvs', 'session'],
  ['get', '/api/cvs/statuses', 'session'],
  ['get', '/api/cvs/{id}', 'session'],
  ['patch', '/api/cvs/{id}', 'session'],
  ['delete', '/api/cvs/{id}', 'session'],
  ['post', '/api/cvs/{id}/retry', 'session'],
  ['get', '/api/cvs/{id}/pdf', 'session'],
  ['post', '/api/cvs/{id}/questions/{questionId}/answer', 'session'],
  ['post', '/api/cvs/{id}/questions/{questionId}/skip', 'session'],
] as const

type Operation = {
  security?: unknown[]
  requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }
  responses: Record<string, unknown>
}
type OpenApiDocument = { openapi: string; paths: Record<string, Record<string, Operation>> }

describe('the API docs', () => {
  describe('with API_DOCS on', () => {
    let app: TestApp
    let document: OpenApiDocument

    beforeAll(async () => {
      app = await createTestApp({ API_DOCS: true })
      const response = await request(app.server()).get('/api/docs-json')
      expect(response.status).toBe(200)
      // supertest types the parsed body as `any`; this test reads it as the OpenAPI document
      document = response.body as OpenApiDocument
    })

    afterAll(() => app.close())

    it('serves the Swagger UI without a session', async () => {
      const response = await request(app.server()).get('/api/docs')
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/html/)
    })

    it('describes every endpoint of the contract and nothing else', () => {
      expect(document.openapi).toMatch(/^3\./)
      const described = Object.entries(document.paths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method} ${path}`),
      )
      expect(described.sort()).toEqual(
        ENDPOINTS.map(([method, path]) => `${method} ${path}`).sort(),
      )
    })

    it.each(ENDPOINTS)(
      '%s %s: a success response, and the cookie when it needs a session',
      (method, path, access) => {
        const operation = document.paths[path]?.[method]
        expect(operation).toBeDefined()
        expect(
          Object.keys(operation?.responses ?? {}).some((status) => status.startsWith('2')),
        ).toBe(true)
        if (access === 'session') {
          expect(operation?.security).toEqual([{ cookie: [] }])
          expect(operation?.responses).toHaveProperty('401')
        } else {
          expect(operation?.security).toBeUndefined()
        }
      },
    )

    it('takes the request bodies from the @cv/shared schemas', () => {
      const body = document.paths['/api/cvs']?.post?.requestBody?.content['application/json']
      expect(Object.keys(body?.schema.properties ?? {})).toEqual(
        expect.arrayContaining(['targetRole', 'sourceText', 'fromCvId', 'language']),
      )
    })
  })

  describe('with API_DOCS off (the default)', () => {
    let app: TestApp

    beforeAll(async () => {
      app = await createTestApp()
    })

    afterAll(() => app.close())

    it.each(['/api/docs', '/api/docs-json'])('%s is 404', async (path) => {
      const response = await request(app.server()).get(path)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })
})

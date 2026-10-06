import { type Cv, type CreateCvBody, cvResponseSchema } from '@cv/shared'
import request from 'supertest'
import type { App } from 'supertest/types'
import { expect } from 'vitest'

/** A source over the 80-character minimum. */
export const SOURCE_TEXT = [
  'Olena Hnatiuk, backend engineer in Kyiv.',
  'Eight years of Node.js and PostgreSQL at a payments company.',
  'Moved card authorisations to an outbox pattern.',
].join('\n')

type NewCv = Partial<Omit<CreateCvBody, 'fromCvId'>> & Record<string, unknown>

export const newCvBody = (overrides: NewCv = {}) => ({
  targetRole: 'Senior Backend Engineer',
  sourceText: SOURCE_TEXT,
  ...overrides,
})

/** Creates a CV for the user behind `cookie` and returns it as the api answered (`202`). */
export const createCv = async (server: App, cookie: string, overrides: NewCv = {}): Promise<Cv> => {
  const response = await request(server)
    .post('/api/cvs')
    .set('Cookie', cookie)
    .send(newCvBody(overrides))
  expect(response.status).toBe(202)
  return cvResponseSchema.parse(response.body).cv
}

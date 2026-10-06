import { type Cv, type CreateCvBody, cvResponseSchema } from '@cv/shared'
import request from 'supertest'
import type { App } from 'supertest/types'
import { expect } from 'vitest'
import { SOURCE_TEXT } from './model'

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

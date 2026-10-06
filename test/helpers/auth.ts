import { userResponseSchema } from '@cv/shared'
import request from 'supertest'
import type { App } from 'supertest/types'
import { expect } from 'vitest'

export const PASSWORD = 'correct horse battery'

export type SignedUp = {
  id: string
  email: string
  /** The `Cookie` header value that carries the session. */
  cookie: string
}

/** The `name=value` part of each `Set-Cookie` header of a response. */
export const sentCookies = (response: request.Response): string[] => {
  const header: unknown = response.headers['set-cookie']
  return Array.isArray(header) ? header.map((line) => String(line).split(';')[0] ?? '') : []
}

/** Signs a new user up and returns their id and session cookie. */
export const signUp = async (server: App, email = 'ann@example.com'): Promise<SignedUp> => {
  const response = await request(server)
    .post('/api/auth/signup')
    .send({ email, password: PASSWORD })
  expect(response.status).toBe(201)
  const { user } = userResponseSchema.parse(response.body)
  const [cookie] = sentCookies(response)
  expect(cookie).toBeDefined()
  return { ...user, cookie: cookie ?? '' }
}

import { randomUUID } from 'node:crypto'
import { errorResponseSchema, userResponseSchema } from '@cv/shared'
import { JwtService } from '@nestjs/jwt'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SESSION_COOKIE } from '../src/auth/session-cookie'
import { DATABASE, type Database } from '../src/database/database.module'
import { users } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { PASSWORD, sentCookies, signUp } from './helpers/auth'

const SEVEN_DAYS_S = 7 * 24 * 60 * 60

const login = (app: TestApp, email: string, password: string) =>
  request(app.server()).post('/api/auth/login').send({ email, password })

const me = (app: TestApp, cookie?: string) => {
  const call = request(app.server()).get('/api/auth/me')
  return cookie === undefined ? call : call.set('Cookie', cookie)
}

const expectError = (response: request.Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  expect(errorResponseSchema.parse(response.body).error.code).toBe(code)
}

/** A token with the right shape whose signature nobody checks: `alg: none`. */
const unsignedToken = (sub: string): string => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub })}.`
}

describe('accounts', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(() => app.close())

  describe('POST /api/auth/signup', () => {
    it('creates the user with a trimmed, lower-cased email and signs them in', async () => {
      const response = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: '  Ann@Example.COM ', password: PASSWORD })

      expect(response.status).toBe(201)
      const { user } = userResponseSchema.parse(response.body)
      expect(response.body).toEqual({ user: { id: user.id, email: 'ann@example.com' } })

      const [cookie] = sentCookies(response)
      const meResponse = await me(app, cookie)
      expect(meResponse.status).toBe(200)
      expect(meResponse.body).toEqual({ user: { id: user.id, email: 'ann@example.com' } })
    })

    it('sets a 7-day httpOnly SameSite=Lax cookie, Secure only behind HTTPS', async () => {
      const plain = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: 'plain@example.com', password: PASSWORD })
      const [line] = plain.headers['set-cookie'] ?? []
      expect(line).toMatch(new RegExp(`^${SESSION_COOKIE}=[^;]+;`))
      expect(line).toContain('HttpOnly')
      expect(line).toContain('SameSite=Lax')
      expect(line).toContain('Path=/')
      expect(line).toContain(`Max-Age=${SEVEN_DAYS_S}`)
      expect(line).not.toContain('Secure')

      const proxied = await request(app.server())
        .post('/api/auth/signup')
        .set('X-Forwarded-Proto', 'https')
        .send({ email: 'proxied@example.com', password: PASSWORD })
      expect(proxied.headers['set-cookie']?.[0]).toContain('Secure')
    })

    it('stores an argon2id hash, never the password', async () => {
      const { id } = await signUp(app.server())
      const db = app.app.get<Database>(DATABASE)
      const [row] = await db.select().from(users).where(eq(users.id, id))
      expect(row?.passwordHash).toMatch(/^\$argon2id\$/)
      expect(row?.passwordHash).not.toContain(PASSWORD)
    })

    it('is 409 EMAIL_TAKEN for an existing email in any case', async () => {
      await signUp(app.server(), 'ann@example.com')
      const response = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: 'ANN@example.com', password: 'another password' })
      expectError(response, 409, 'EMAIL_TAKEN')
      expect(response.headers['set-cookie']).toBeUndefined()
    })

    it('is 400 VALIDATION_ERROR naming the bad fields', async () => {
      const response = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: 'not-an-email', password: 'short' })
      expectError(response, 400, 'VALIDATION_ERROR')
      const { fields } = z
        .object({ fields: z.record(z.string(), z.string()) })
        .parse(errorResponseSchema.parse(response.body).error.details)
      expect(Object.keys(fields).sort()).toEqual(['email', 'password'])

      const tooLong = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: 'long@example.com', password: 'x'.repeat(129) })
      expectError(tooLong, 400, 'VALIDATION_ERROR')
    })

    it('ignores a userId in the body', async () => {
      const chosen = randomUUID()
      const response = await request(app.server())
        .post('/api/auth/signup')
        .send({ email: 'ann@example.com', password: PASSWORD, userId: chosen, id: chosen })
      expect(response.status).toBe(201)
      expect(userResponseSchema.parse(response.body).user.id).not.toBe(chosen)
    })
  })

  describe('POST /api/auth/login', () => {
    it('signs a user in with the email in any case', async () => {
      const { id } = await signUp(app.server(), 'ann@example.com')
      const response = await login(app, ' ANN@example.com', PASSWORD)
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ user: { id, email: 'ann@example.com' } })

      const [cookie] = sentCookies(response)
      expect((await me(app, cookie)).body).toEqual({ user: { id, email: 'ann@example.com' } })
    })

    it('answers an unknown email and a wrong password the same way', async () => {
      await signUp(app.server(), 'ann@example.com')
      const unknown = await login(app, 'bob@example.com', PASSWORD)
      const wrong = await login(app, 'ann@example.com', 'wrong password')

      expectError(unknown, 401, 'INVALID_CREDENTIALS')
      expect(wrong.status).toBe(unknown.status)
      expect(wrong.body).toEqual(unknown.body)
      expect(unknown.headers['set-cookie']).toBeUndefined()
      expect(wrong.headers['set-cookie']).toBeUndefined()
    })

    it('is throttled at 30 attempts a minute per IP with Retry-After', async () => {
      // its own app: the throttler counts in memory, per api instance
      const fresh = await createTestApp()
      try {
        for (let attempt = 1; attempt <= 30; attempt++) {
          expectError(
            await login(fresh, 'bob@example.com', 'wrong password'),
            401,
            'INVALID_CREDENTIALS',
          )
        }
        const blocked = await login(fresh, 'bob@example.com', 'wrong password')
        expectError(blocked, 429, 'RATE_LIMITED')
        expect(errorResponseSchema.parse(blocked.body).error.details).toEqual({ limit: 30 })
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
        expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60)

        // signup is not throttled by the login limit
        await signUp(fresh.server(), 'ann@example.com')
      } finally {
        await fresh.close()
      }
    })

    it('counts the address the proxy saw, not one the client wrote into X-Forwarded-For', async () => {
      // as nginx forwards it: whatever the client sent, then the address nginx saw
      const fresh = await createTestApp()
      const viaProxy = (spoofed: string) =>
        login(fresh, 'bob@example.com', 'wrong password').set(
          'X-Forwarded-For',
          `${spoofed}, 172.20.0.1`,
        )
      try {
        for (let attempt = 1; attempt <= 30; attempt++) {
          expectError(await viaProxy(`203.0.113.${attempt}`), 401, 'INVALID_CREDENTIALS')
        }
        expectError(await viaProxy('198.51.100.7'), 429, 'RATE_LIMITED')
      } finally {
        await fresh.close()
      }
    })
  })

  describe('POST /api/auth/logout', () => {
    it('clears the cookie, so me is 401 afterwards', async () => {
      const agent = request.agent(app.server())
      await agent.post('/api/auth/signup').send({ email: 'ann@example.com', password: PASSWORD })
      expect((await agent.get('/api/auth/me')).status).toBe(200)

      const response = await agent.post('/api/auth/logout')
      expect(response.status).toBe(204)
      expect(response.headers['set-cookie']?.[0]).toMatch(
        new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`),
      )
      expectError(await agent.get('/api/auth/me'), 401, 'UNAUTHORIZED')
    })

    it('works without a cookie and with a broken one', async () => {
      expect((await request(app.server()).post('/api/auth/logout')).status).toBe(204)
      const broken = await request(app.server())
        .post('/api/auth/logout')
        .set('Cookie', `${SESSION_COOKIE}=not-a-token`)
      expect(broken.status).toBe(204)
    })
  })

  describe('GET /api/auth/me and the guard', () => {
    it('is 401 UNAUTHORIZED without a cookie', async () => {
      expectError(await me(app), 401, 'UNAUTHORIZED')
    })

    it('rejects a token that is not verified: tampered, unsigned, foreign or expired', async () => {
      const { id, cookie } = await signUp(app.server())
      const [header, payload] = cookie.slice(SESSION_COOKIE.length + 1).split('.')
      const otherUser = Buffer.from(JSON.stringify({ sub: randomUUID() })).toString('base64url')
      const signer = new JwtService()
      const foreign = await signer.signAsync({ sub: id }, { secret: 'x'.repeat(48) })
      const expired = await signer.signAsync(
        { sub: id, exp: Math.floor(Date.now() / 1000) - 60 },
        { secret: 'x'.repeat(48) },
      )

      for (const token of [
        `${header}.${otherUser}.${payload}`,
        unsignedToken(id),
        foreign,
        expired,
        'garbage',
      ]) {
        expectError(await me(app, `${SESSION_COOKIE}=${token}`), 401, 'UNAUTHORIZED')
      }
    })

    it('is 401 when the signed-in user no longer exists', async () => {
      const { id, cookie } = await signUp(app.server())
      await app.app.get<Database>(DATABASE).delete(users).where(eq(users.id, id))
      expectError(await me(app, cookie), 401, 'UNAUTHORIZED')
    })
  })

  describe('the signing secret', () => {
    it('survives an api restart: a new instance accepts the old cookie', async () => {
      const first = await createTestApp()
      const { id, cookie } = await signUp(first.server(), 'restart@example.com')
      await first.close()

      const second = await createTestApp()
      try {
        const response = await me(second, cookie)
        expect(response.status).toBe(200)
        expect(userResponseSchema.parse(response.body).user.id).toBe(id)
      } finally {
        await second.close()
      }
    })

    it('comes from JWT_SECRET when it is set', async () => {
      const secret = 's'.repeat(48)
      const withEnv = await createTestApp({ JWT_SECRET: secret })
      const sameEnv = await createTestApp({ JWT_SECRET: secret })
      const withStored = await createTestApp()
      try {
        const { id, cookie } = await signUp(withEnv.server())
        expect(userResponseSchema.parse((await me(sameEnv, cookie)).body).user.id).toBe(id)
        expectError(await me(withStored, cookie), 401, 'UNAUTHORIZED')

        const token = await new JwtService().signAsync({ sub: id }, { secret })
        expect((await me(withEnv, `${SESSION_COOKIE}=${token}`)).status).toBe(200)
      } finally {
        await Promise.all([withEnv.close(), sameEnv.close(), withStored.close()])
      }
    })
  })
})

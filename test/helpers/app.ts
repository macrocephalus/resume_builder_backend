import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { App } from 'supertest/types'
import { AppModule } from '../../src/app.module'
import type { Env } from '../../src/config/env.schema'
import { setupApp } from '../../src/setup-app'
import { testEnv } from './env'

export type TestApp = {
  app: INestApplication
  /** The Node http server, for supertest. */
  server: () => App
  close: () => Promise<void>
}

/**
 * The api as `main.ts` builds it, on the test database, listening on no port. `overrides`
 * replaces parts of the test env, e.g. `JWT_SECRET`.
 */
export const createTestApp = async (overrides: Partial<Env> = {}): Promise<TestApp> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ ...testEnv(), ...overrides })],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  setupApp(app)
  await app.init()
  // Nest types the server as `any`; supertest wants its `App`
  return { app, server: () => app.getHttpServer() as App, close: () => app.close() }
}

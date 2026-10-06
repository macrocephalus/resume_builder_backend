import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { App } from 'supertest/types'
import { AppModule } from '../../src/app.module'
import type { Env } from '../../src/config/env.schema'
import { GENERATION_TIMING } from '../../src/generation/generation.queue'
import { GENERATION_LIMITS } from '../../src/limits/generation-limits'
import { setupApp } from '../../src/setup-app'
import { TEST_LIMITS, TEST_TIMING, testEnv } from './env'

export type TestApp = {
  app: INestApplication
  /** The Node http server, for supertest. */
  server: () => App
  close: () => Promise<void>
}

/**
 * The api as `main.ts` builds it, on the test database, listening on no port, with the tests'
 * generation timing and small limits. `overrides` replaces parts of the test env, e.g. `JWT_SECRET`.
 */
export const createTestApp = async (overrides: Partial<Env> = {}): Promise<TestApp> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ ...testEnv(), ...overrides })],
  })
    .overrideProvider(GENERATION_TIMING)
    .useValue(TEST_TIMING)
    .overrideProvider(GENERATION_LIMITS)
    .useValue(TEST_LIMITS)
    .compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  setupApp(app)
  await app.init()
  // Nest types the server as `any`; supertest wants its `App`
  return { app, server: () => app.getHttpServer() as App, close: () => app.close() }
}

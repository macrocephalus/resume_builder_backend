import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { LanguageModel } from 'ai'
import type { App } from 'supertest/types'
import { FAST_LANGUAGE_MODEL } from '../../src/agents/llm'
import { AppModule } from '../../src/app.module'
import type { Env } from '../../src/config/env.schema'
import { GENERATION_TIMING } from '../../src/generation/generation.queue'
import { GENERATION_LIMITS } from '../../src/limits/generation-limits'
import { ANSWER_WORDING_TIMEOUT } from '../../src/questions/answer-wording.service'
import { setupApp } from '../../src/setup-app'
import { TEST_LIMITS, TEST_TIMING, testEnv } from './env'
import { scriptedModel } from './model'

export type TestApp = {
  app: INestApplication
  /** The Node http server, for supertest. */
  server: () => App
  close: () => Promise<void>
}

/** How long a wording call may take in the tests. */
export const TEST_WORDING_TIMEOUT_MS = 300

/**
 * The api as `main.ts` builds it, on the test database, listening on no port, with the tests'
 * generation timing and small limits. `overrides` replaces parts of the test env, e.g. `JWT_SECRET`.
 * `fastModel` words the answers; by default a model that fails every call, so answers go in as
 * written and no test reaches Anthropic.
 */
export const createTestApp = async (
  overrides: Partial<Env> = {},
  { fastModel = scriptedModel() }: { fastModel?: LanguageModel } = {},
): Promise<TestApp> => {
  const env = { ...testEnv(), ...overrides }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(GENERATION_TIMING)
    .useValue(TEST_TIMING)
    .overrideProvider(GENERATION_LIMITS)
    .useValue(TEST_LIMITS)
    .overrideProvider(FAST_LANGUAGE_MODEL)
    .useValue(fastModel)
    .overrideProvider(ANSWER_WORDING_TIMEOUT)
    .useValue(TEST_WORDING_TIMEOUT_MS)
    .compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  setupApp(app, env)
  await app.init()
  // Nest types the server as `any`; supertest wants its `App`
  return { app, server: () => app.getHttpServer() as App, close: () => app.close() }
}

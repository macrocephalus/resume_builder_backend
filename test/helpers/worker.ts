import { type Cv, cvResponseSchema, isInProgress } from '@cv/shared'
import { Test } from '@nestjs/testing'
import type { LanguageModel } from 'ai'
import request from 'supertest'
import type { App } from 'supertest/types'
import { LANGUAGE_MODEL } from '../../src/agents/llm'
import { WorkerModule } from '../../src/worker.module'
import { testEnv } from './env'

export type TestWorker = { close: () => Promise<void> }

/** The worker process as `worker.ts` builds it, in this process, on a scripted model. */
export const startTestWorker = async (model: LanguageModel): Promise<TestWorker> => {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(testEnv())],
  })
    .overrideProvider(LANGUAGE_MODEL)
    .useValue(model)
    .compile()
  await moduleRef.init()
  return { close: () => moduleRef.close() }
}

/** Polls `GET /api/cvs/:id` like the frontend until the CV is out of progress. */
export const waitForCv = async (
  server: App,
  cookie: string,
  id: string,
  timeoutMs = 10_000,
): Promise<Cv> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await request(server).get(`/api/cvs/${id}`).set('Cookie', cookie)
    const { cv } = cvResponseSchema.parse(response.body)
    if (!isInProgress(cv.status)) return cv
    if (Date.now() > deadline) throw new Error(`CV ${id} still ${cv.status} after ${timeoutMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Polls until `check` holds, for waits that have no HTTP view (a deleted CV). */
export const waitUntil = async (check: () => Promise<boolean>, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met after ${timeoutMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

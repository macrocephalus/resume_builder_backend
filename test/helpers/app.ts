import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { App } from 'supertest/types'
import { AppModule } from '../../src/app.module'
import { setupApp } from '../../src/setup-app'
import { testEnv } from './env'

export type TestApp = {
  app: INestApplication
  /** The Node http server, for supertest. */
  server: () => App
  close: () => Promise<void>
}

/** The api as `main.ts` builds it, on the test database, listening on no port. */
export const createTestApp = async (): Promise<TestApp> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv())],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  setupApp(app)
  await app.init()
  // Nest types the server as `any`; supertest wants its `App`
  return { app, server: () => app.getHttpServer() as App, close: () => app.close() }
}

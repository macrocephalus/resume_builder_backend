import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'

/** What the api needs besides its modules; shared by `main.ts` and the e2e tests. */
export const setupApp = (app: NestExpressApplication): void => {
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api')
  app.disable('x-powered-by')
  app.use(cookieParser())
  app.enableShutdownHooks()
}

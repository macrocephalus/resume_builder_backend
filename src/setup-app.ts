import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'
import { trustProxy } from './common/http/trust-proxy'

/** What the api needs besides its modules; shared by `main.ts` and the e2e tests. */
export const setupApp = (app: NestExpressApplication): void => {
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api')
  app.disable('x-powered-by')
  // the client's IP and scheme as the web container's nginx saw them: the login throttle counts
  // per client, and the session cookie is Secure behind HTTPS
  app.set('trust proxy', trustProxy)
  app.use(cookieParser())
  app.enableShutdownHooks()
}

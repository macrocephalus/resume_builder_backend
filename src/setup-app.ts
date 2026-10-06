import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { Logger } from 'nestjs-pino'
import { setupApiDocs } from './api-docs'
import { trustProxy } from './common/http/trust-proxy'
import type { Env } from './config/env.schema'
import { JSON_BODY } from './config/limits'

/** What the api needs besides its modules; shared by `main.ts` and the e2e tests. */
export const setupApp = (app: NestExpressApplication, env: Pick<Env, 'API_DOCS'>): void => {
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api')
  app.disable('x-powered-by')
  // the client's IP and scheme as the web container's nginx saw them: the login throttle counts
  // per client, and the session cookie is Secure behind HTTPS
  app.set('trust proxy', trustProxy)
  // Nest skips its own JSON parser once this one is registered
  app.useBodyParser('json', { limit: JSON_BODY.bytes })
  app.use(cookieParser())
  app.enableShutdownHooks()
  if (env.API_DOCS) setupApiDocs(app)
}

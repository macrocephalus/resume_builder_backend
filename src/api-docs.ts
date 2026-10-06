import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { SESSION_COOKIE } from './auth/session-cookie'

/** Where the Swagger UI is served; the OpenAPI document is next to it, at `<path>-json`. */
export const API_DOCS_PATH = 'api/docs'

/**
 * Serves the OpenAPI document built from the controllers' `@Api*` decorators, with a Swagger UI.
 * Only when `API_DOCS` is on (development): a production api does not describe itself.
 * Called before the app is initialised, so the routes are registered ahead of the `404` handler.
 */
export const setupApiDocs = (app: INestApplication): void => {
  const config = new DocumentBuilder()
    .setTitle('AI CV Builder API')
    .setDescription(
      'The REST contract of the AI CV Builder (docs/api.md). Sign up or log in first: the ' +
        'session is an httpOnly cookie, which the browser then sends with every request.',
    )
    .setVersion('1')
    .addCookieAuth(SESSION_COOKIE)
    .build()
  SwaggerModule.setup(API_DOCS_PATH, app, () => SwaggerModule.createDocument(app, config), {
    swaggerOptions: { withCredentials: true },
  })
}

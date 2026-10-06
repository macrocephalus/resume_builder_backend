import { type ErrorCode, errorResponseSchema } from '@cv/shared'
import { applyDecorators } from '@nestjs/common'
import { ApiBody, ApiCookieAuth, ApiResponse, type SchemaObject } from '@nestjs/swagger'
import { type ZodType, z } from 'zod'

/**
 * The HTTP status each error code is sent with (docs/api.md "Errors"), for the OpenAPI document
 * only: the code that throws an `AppError` names its status itself.
 */
const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  INPUT_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  PDF_UNREADABLE: 422,
  RATE_LIMITED: 429,
  TOO_MANY_ACTIVE: 429,
  DATA_CORRUPT: 500,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>

/**
 * Documents the errors a route answers with: one response per HTTP status, in the error shape of
 * `@cv/shared`, listing the codes sent with it.
 *
 *   @ApiErrors('VALIDATION_ERROR', 'EMAIL_TAKEN')
 */
export const ApiErrors = (...codes: ErrorCode[]) => {
  const statuses = [...new Set(codes.map((code) => ERROR_STATUS[code]))]
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: codes
          .filter((code) => ERROR_STATUS[code] === status)
          .map((code) => `\`${code}\``)
          .join(', '),
        standardSchema: errorResponseSchema,
      }),
    ),
  )
}

/** A route (or a controller) that needs the session cookie: without one it is `401`. */
export const ApiSession = () => applyDecorators(ApiCookieAuth(), ApiErrors('UNAUTHORIZED'))

/**
 * Documents a JSON body with the `@cv/shared` schema its `ZodValidationPipe` parses, as the client
 * sends it (fields with a default are optional).
 */
export const ApiZodBody = (schema: ZodType) =>
  // Zod's JSONSchema type is the generic one; with this target it emits the OpenAPI 3.0 dialect
  ApiBody({
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as SchemaObject,
  })

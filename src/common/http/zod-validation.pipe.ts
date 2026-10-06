import type { PipeTransform } from '@nestjs/common'
import type { ZodError, ZodType } from 'zod'
import { AppError } from '../errors/app-error'

/** `details.fields`: the first message per field, keyed by its dotted path; `body` for the whole body. */
export const fieldErrors = (error: ZodError): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path.map(String).join('.') || 'body'
    fields[field] ??= issue.message
  }
  return fields
}

/**
 * Parses a body, query or param with a schema from `@cv/shared` and hands the controller the
 * parsed value (unknown keys stripped); a failure is `400 VALIDATION_ERROR` with `details.fields`.
 *
 *   @Body(new ZodValidationPipe(createCvBodySchema)) body: CreateCvBody
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data
    throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
      fields: fieldErrors(result.error),
    })
  }
}

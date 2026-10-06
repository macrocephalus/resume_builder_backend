import type { PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'
import { validationError } from '../errors/validation-error'

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
    throw validationError(result.error)
  }
}

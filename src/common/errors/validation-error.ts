import type { ZodError } from 'zod'
import { AppError } from './app-error'

/** `details.fields`: the first message per field, keyed by its dotted path; `body` for the whole body. */
export const fieldErrors = (error: ZodError): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path.map(String).join('.') || 'body'
    fields[field] ??= issue.message
  }
  return fields
}

/** `400 VALIDATION_ERROR` naming each field `error` found wrong. */
export const validationError = (error: ZodError): AppError =>
  new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { fields: fieldErrors(error) })

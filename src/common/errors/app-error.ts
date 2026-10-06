import type { ErrorCode } from '@cv/shared'

/**
 * An error the api answers with on purpose: `{ error: { code, message, details } }` with the given
 * status (docs/api.md "Errors"). Anything else that reaches the error filter is `500 INTERNAL`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    /** Response headers that go with it, e.g. `Retry-After`. */
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

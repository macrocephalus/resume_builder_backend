import type { GenerationLimits } from './generation-limits'

/** The generations a user started inside the window, as counted by the database. */
export type StartedInWindow = {
  used: number
  /** The oldest counted start; null when there is none. */
  oldest: Date | null
  /** The database's clock, the one the starts were stamped with. */
  now: Date
}

export type HourlyWindow = {
  used: number
  limit: number
  /**
   * When the oldest counted start leaves the window, freeing one; with none, a window from now.
   * Two starts that raced past the limit (accepted) can leave the user still full at that moment.
   */
  resetsAt: Date
  /** Seconds until `resetsAt`, at least 1: the `Retry-After` of a refused start. */
  retryAfterSeconds: number
  /** No start is left until `resetsAt`. */
  full: boolean
}

/** The sliding hourly limit on started generations (docs/api.md, `GET /api/usage`). */
export const hourlyWindow = (
  { used, oldest, now }: StartedInWindow,
  { perHour: limit, windowMs }: Pick<GenerationLimits, 'perHour' | 'windowMs'>,
): HourlyWindow => {
  const resetsAt = new Date((oldest ?? now).getTime() + windowMs)
  return {
    used,
    limit,
    resetsAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)),
    full: used >= limit,
  }
}

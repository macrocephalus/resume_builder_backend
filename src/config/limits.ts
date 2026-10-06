/**
 * The numbers the server is tuned by, in one place: timeouts, the session, throttles now;
 * generations per hour, active CVs per user and question caps as their tickets land.
 */
export const TIMEOUTS = {
  /** A Postgres connection that cannot be made fails fast, so `/api/health` answers 503. */
  databaseConnectMs: 5_000,
  /** The worker gives up on Redis at start after this and exits, so compose restarts it. */
  redisStartMs: 10_000,
} as const

export const SESSION = {
  /** Lifetime of the JWT and of its cookie. */
  ttlSeconds: 7 * 24 * 60 * 60,
} as const

/** Requests per window, counted in memory by `@nestjs/throttler` (one api instance). */
export const THROTTLES = {
  /** Per IP, so a password can't be brute-forced quickly. */
  login: { limit: 30, ttlMs: 60_000 },
} as const

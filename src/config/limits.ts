/**
 * The numbers the server is tuned by, in one place: timeouts now; generations per hour, active
 * CVs per user, ingest and login throttles, question caps as their tickets land.
 */
export const TIMEOUTS = {
  /** A Postgres connection that cannot be made fails fast, so `/api/health` answers 503. */
  databaseConnectMs: 5_000,
  /** The worker gives up on Redis at start after this and exits, so compose restarts it. */
  redisStartMs: 10_000,
} as const

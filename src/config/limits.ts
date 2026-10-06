/**
 * The numbers the server is tuned by, in one place: timeouts, generation, the session, throttles
 * and the questions of a draft now; generations per hour as its ticket lands.
 */
export const TIMEOUTS = {
  /** A Postgres connection that cannot be made fails fast, so `/api/health` answers 503. */
  databaseConnectMs: 5_000,
  /** The worker gives up on Redis at start after this and exits, so compose restarts it. */
  redisStartMs: 10_000,
  /**
   * `POST /api/cvs` stops waiting for the queue after this and still answers 202: the job row is
   * committed, and the worker's recovery puts a lost job back on the queue.
   */
  enqueueMs: 2_000,
} as const

export const GENERATION = {
  /** CVs of one user in queued / generating / retrying at once; another one is 429. */
  activePerUser: 2,
  /** Attempts of one generation job (BullMQ `attempts`, `cvs.max_attempts`). */
  attempts: 3,
  /** First delay between attempts; BullMQ doubles it each time. */
  backoffMs: 5_000,
  /** How long a failed BullMQ job stays in Redis for debugging; Postgres keeps the outcome. */
  failedJobKeepSeconds: 24 * 60 * 60,
} as const

export const SESSION = {
  /** Lifetime of the JWT and of its cookie. */
  ttlSeconds: 7 * 24 * 60 * 60,
} as const

/**
 * The multipart body of `POST /api/ingest/pdf`: one `file` part of at most `API_LIMITS.pdf.bytes`
 * and nothing else, so no text field can make the body bigger than the file.
 */
export const PDF_UPLOAD = {
  parts: 1,
  files: 1,
  fields: 0,
  headerPairs: 20,
} as const

/** Requests per window, counted in memory by `@nestjs/throttler` (one api instance). */
export const THROTTLES = {
  /** Per IP, so a password can't be brute-forced quickly. */
  login: { limit: 30, ttlMs: 60_000 },
  /** Per user, so parsing PDFs can't be used to load the server. */
  ingest: { limit: 20, ttlMs: 60_000 },
} as const

/** The questions a new draft is saved with (backend architecture §3, "Which questions are kept"). */
export const QUESTIONS = {
  /** Open questions of one draft. */
  open: 12,
  /** Bullets offered back as yes/no claims. */
  confirm: 5,
  /** Questions the model wrote, in its order. */
  model: 7,
  /** Options of the one tick-what-applies skills question. */
  multiOptions: 8,
} as const

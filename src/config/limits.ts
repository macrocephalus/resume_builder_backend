/**
 * The numbers the server is tuned by, in one place: timeouts, generation and its limits, the
 * session, throttles and the questions of a draft.
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
  /**
   * Generations one user may start (a CV created or a manual Retry) in any `windowMs`; the next is
   * 429 RATE_LIMITED. Automatic attempts don't count, and deleting a CV gives nothing back.
   */
  perHour: 10,
  /** The sliding window of `perHour`. */
  windowMs: 3_600_000,
  /** CVs of one user in queued / generating / retrying at once; another one is 429. */
  activePerUser: 4,
  /** Attempts of one generation job (BullMQ `attempts`, `cvs.max_attempts`). */
  attempts: 3,
  /** First delay between attempts; BullMQ doubles it each time. */
  backoffMs: 5_000,
  /**
   * How long a worker's hold on a running job lasts; BullMQ renews it every half of this while the
   * attempt runs. A worker that died (or closed on SIGTERM) stops renewing, so its job is stalled
   * and runs again within about a minute (the lock plus BullMQ's 30 s stalled check).
   */
  lockMs: 30_000,
  /** How often the worker puts the jobs Redis lost back on the queue (and once at start). */
  recoveryMs: 60_000,
  /** How long a failed BullMQ job stays in Redis for debugging; Postgres keeps the outcome. */
  failedJobKeepSeconds: 24 * 60 * 60,
} as const

export const SESSION = {
  /** Lifetime of the JWT and of its cookie. */
  ttlSeconds: 7 * 24 * 60 * 60,
} as const

/** A JSON request body (the PDF upload is multipart and limited by `PDF_UPLOAD`). */
export const JSON_BODY = {
  /**
   * A `PATCH /api/cvs/:id` draft with every `CV_LIMITS` field full is ~111k characters: ~217 KB
   * in Cyrillic, ~324 KB in CJK. Express's 100 KB default refused a long Cyrillic draft with 413.
   */
  bytes: 512 * 1024,
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

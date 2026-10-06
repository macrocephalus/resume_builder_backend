import { z } from 'zod'

/**
 * Where compose.yaml publishes the project's own Postgres and Redis on the host (project-specific
 * ports, so nothing installed on the machine is ever used by mistake). `pnpm dev` and the e2e
 * tests run against these unless the environment says otherwise; in Docker, compose sets the
 * URLs to the service names.
 */
export const LOCAL_DATABASE_URL = 'postgres://cv:cv@127.0.0.1:55432/cv'
export const LOCAL_REDIS_URL = 'redis://127.0.0.1:56379'

/**
 * Everything the api and the worker read from the environment. Parsed once at start; a missing
 * or malformed variable stops the process with a message that names it (`EnvError`). The only
 * variable without a default is the one secret, `ANTHROPIC_API_KEY`.
 */
export const envSchema = z.object({
  DATABASE_URL: z.url().default(LOCAL_DATABASE_URL),
  REDIS_URL: z.url().default(LOCAL_REDIS_URL),
  /** Prefix of the BullMQ keys; the e2e tests use their own so they never meet a dev worker. */
  QUEUE_PREFIX: z.string().min(1).default('cv'),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
  /** Overrides the secret kept in `app_secrets`; generated on first start when absent. */
  JWT_SECRET: z.string().min(32).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Logs what the user wrote and the model answered (a CV's source, answers, the prompt, the
   * submissions) under `content`, at debug. Personal data: for development only, off by default.
   */
  LOG_CONTENT: z.stringbool().default(false),
  /** Human-readable lines through pino-pretty, a dev dependency: not in the docker image. */
  LOG_PRETTY: z.stringbool().default(false),
  /** Serves the OpenAPI document and the Swagger UI at `/api/docs`; off unless asked for. */
  API_DOCS: z.stringbool().default(false),
})

export type Env = z.infer<typeof envSchema>

export class EnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvError'
  }
}

export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const result = envSchema.safeParse(source)
  if (result.success) return result.data
  const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
  throw new EnvError(`Invalid environment:\n${lines.join('\n')}`)
}

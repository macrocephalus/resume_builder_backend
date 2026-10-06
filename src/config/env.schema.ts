import { z } from 'zod'

/**
 * Everything the api and the worker read from the environment. Parsed once at start; a missing
 * or malformed variable stops the process with a message that names it (`EnvError`).
 */
export const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** Prefix of the BullMQ keys; the e2e tests use their own so they never meet a dev worker. */
  QUEUE_PREFIX: z.string().min(1).default('cv'),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Overrides the secret kept in `app_secrets`; generated on first start when absent. */
  JWT_SECRET: z.string().min(32).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
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

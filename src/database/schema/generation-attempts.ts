import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { generationJobs } from './generation-jobs'

export type AttemptStatus = 'running' | 'succeeded' | 'failed'

/** One row per attempt of a generation job. Audit only: nothing is read back for behaviour. */
export const generationAttempts = pgTable(
  'generation_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    attempt: integer().notNull(),
    status: text().$type<AttemptStatus>().notNull().default('running'),
    model: text().notNull(),
    promptVersion: text().notNull(),
    agentSteps: integer(),
    inputTokens: integer(),
    outputTokens: integer(),
    cacheReadTokens: integer(),
    cacheWriteTokens: integer(),
    durationMs: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('generation_attempts_job_id_idx').on(table.jobId)],
)

import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { cvs } from './cvs'
import { users } from './users'

/**
 * One row per generation job — a generation the user started (a CV created or a manual Retry).
 * The hourly limit counts these rows; a job outlives its CV, which is why `cv_id` is set null.
 */
export const generationJobs = pgTable(
  'generation_jobs',
  {
    /** Also the BullMQ jobId. */
    id: uuid().primaryKey().defaultRandom(),
    cvId: uuid().references(() => cvs.id, { onDelete: 'set null' }),
    /** Copied from the CV, never from a request. */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('generation_jobs_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('generation_jobs_cv_id_idx').on(table.cvId),
  ],
)

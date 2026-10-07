import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * One row per wording call: how many of a batch's answers a user's replies sent to the fast
 * model. The hourly wording budget sums these rows; tied to the user only, they outlive the CV.
 */
export const answerWordings = pgTable(
  'answer_wordings',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answers: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('answer_wordings_user_id_created_at_idx').on(table.userId, table.createdAt)],
)

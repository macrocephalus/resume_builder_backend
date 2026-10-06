import type {
  Answer,
  QuestionKind,
  QuestionOrigin,
  QuestionStatus,
  QuestionTarget,
} from '@cv/shared'
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { cvs } from './cvs'

export const cvQuestions = pgTable(
  'cv_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    cvId: uuid()
      .notNull()
      .references(() => cvs.id, { onDelete: 'cascade' }),
    kind: text().$type<QuestionKind>().notNull(),
    origin: text().$type<QuestionOrigin>().notNull(),
    text: text().notNull(),
    /** Short field name, e.g. "English". */
    label: text().notNull(),
    options: jsonb().$type<string[]>(),
    /** For `confirm`: the claim the user confirms or denies. */
    claim: text(),
    target: jsonb().$type<QuestionTarget>().notNull(),
    status: text().$type<QuestionStatus>().notNull().default('open'),
    answer: jsonb().$type<Answer>(),
    position: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('cv_questions_cv_id_idx').on(table.cvId)],
)

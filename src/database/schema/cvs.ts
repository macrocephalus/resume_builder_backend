import type {
  CvData,
  CvLanguage,
  CvStatus,
  GenerationStage,
  Requirement,
  SourceType,
} from '@cv/shared'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/** A question the user answered, fed into every later prompt (root architecture §6.5). */
export type Fact = { question: string; answer: string }

/** Counts shown in the UI after verification (backend architecture §4). */
export type Verification = {
  verified: number
  sentToConfirm: number
  skillsToConfirm: number
  cleared: number
}

export const cvs = pgTable(
  'cvs',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set when created "for another role" from this CV. */
    parentCvId: uuid().references((): AnyPgColumn => cvs.id, { onDelete: 'set null' }),
    /** Defaults to the target role, user-editable. */
    title: text().notNull(),
    targetRole: text().notNull(),
    /** Describes the role, never the person. */
    roleContext: text(),
    language: text().$type<CvLanguage>().notNull().default('en'),
    sourceType: text().$type<SourceType>().notNull(),
    /** For display only. */
    sourceFilename: text(),
    /** Reused by retries and new-role CVs. */
    sourceText: text().notNull(),
    facts: jsonb().$type<Fact[]>().notNull().default([]),
    status: text().$type<CvStatus>().notNull(),
    /** Generating sub-step. */
    stage: text().$type<GenerationStage>(),
    attempt: integer().notNull().default(1),
    maxAttempts: integer().notNull().default(3),
    /** Only when failed. */
    errorCode: text(),
    error: text(),
    /** Null until the first draft. */
    data: jsonb().$type<CvData>(),
    requirements: jsonb().$type<Requirement[]>().notNull().default([]),
    suggestedRoles: jsonb().$type<string[]>().notNull().default([]),
    verification: jsonb().$type<Verification>(),
    /** 0 until the first draft, +1 on every write of `data`; optimistic locking. */
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cvs_user_id_idx').on(table.userId),
    index('cvs_status_created_at_idx').on(table.status, table.createdAt),
  ],
)

import { pgTable, text } from 'drizzle-orm/pg-core'

/** Secrets the server generates for itself, e.g. the JWT signing secret (backend architecture §6). */
export const appSecrets = pgTable('app_secrets', {
  name: text().primaryKey(),
  value: text().notNull(),
})

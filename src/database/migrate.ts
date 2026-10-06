import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/** The committed migrations in `drizzle/` at the package root; the same path from src/ and dist/. */
export const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', 'drizzle')

/** Applies the pending migrations on its own short-lived connection. The api runs it before listening. */
export const runMigrations = async (databaseUrl: string): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}

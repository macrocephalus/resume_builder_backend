import { type SQL, eq, gt, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Executor } from '../database/database.module'
import { users } from '../database/schema'

/**
 * Locks the user's row until the transaction ends, so the limits of one user are counted one
 * request after another; the weakest lock they conflict on, so inserts that only reference the
 * user don't wait.
 */
export const lockUser = async (tx: Executor, userId: string): Promise<void> => {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update')
}

/** Rows stamped within the last `windowMs`, on the database's clock, which stamped them. */
export const createdWithin = (column: PgColumn, windowMs: number): SQL =>
  gt(column, sql`now() - ${windowMs} * interval '1 millisecond'`)

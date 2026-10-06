import type { CvStatus } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvs } from '../database/schema'
import { fromStatuses } from './from-statuses'

/** Columns that change together with the status (the stage, the attempt, the error). */
export type StatusChanges = Partial<
  Pick<typeof cvs.$inferInsert, 'stage' | 'attempt' | 'errorCode' | 'error'>
>

/**
 * The only writer of `cvs.status` (backend architecture §1, "Rules"). Every write is a
 * compare-and-set: the row changes only while it is in a status the shared machine allows the
 * move from, so a stale worker result or a deleted CV changes nothing.
 */
@Injectable()
export class CvStatusService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Moves the CV to `to`; `false` when it was not in an allowed status (or is gone). */
  async transition(
    cvId: string,
    to: CvStatus,
    changes: StatusChanges = {},
    executor: Executor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(cvs)
      .set({ ...changes, status: to, updatedAt: sql`now()` })
      .where(and(eq(cvs.id, cvId), inArray(cvs.status, fromStatuses(to))))
      .returning({ id: cvs.id })
    return rows.length > 0
  }
}

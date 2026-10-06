import type { CvStatus, GenerationStage } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvQuestions, cvs } from '../database/schema'
import { fromStatuses } from './from-statuses'

/** Columns that change together with the status (the stage, the attempt, the error). */
export type StatusChanges = Partial<
  Pick<typeof cvs.$inferInsert, 'stage' | 'attempt' | 'errorCode' | 'error'>
>

export type TransitionOptions = {
  changes?: StatusChanges
  /**
   * Narrows the statuses the move is made from (each must be allowed by the machine): a save of
   * a generation's result, say, applies only to a CV still `generating`.
   */
  from?: readonly CvStatus[]
  /** The caller's transaction, when the move must agree with other writes. */
  executor?: Executor
}

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
    { changes = {}, from, executor = this.db }: TransitionOptions = {},
  ): Promise<boolean> {
    const allowed = fromStatuses(to)
    const froms = from ?? allowed
    const forbidden = froms.filter((status) => !allowed.includes(status))
    if (froms.length === 0 || forbidden.length > 0) {
      throw new Error(`Not a move of the status machine: ${forbidden.join(', ')} → ${to}`)
    }
    const rows = await executor
      .update(cvs)
      .set({ ...changes, status: to, updatedAt: sql`now()` })
      .where(and(eq(cvs.id, cvId), inArray(cvs.status, [...froms])))
      .returning({ id: cvs.id })
    return rows.length > 0
  }

  /**
   * `needs_input → ready` once no question of the CV is open (the last one answered, skipped or
   * about a removed item). `false` when one is still open or the CV was not `needs_input`.
   */
  async readyIfNoneOpen(cvId: string, executor: Executor): Promise<boolean> {
    const [open] = await executor
      .select({ count: count() })
      .from(cvQuestions)
      .where(and(eq(cvQuestions.cvId, cvId), eq(cvQuestions.status, 'open')))
    if (open?.count !== 0) return false
    return this.transition(cvId, 'ready', { from: ['needs_input'], executor })
  }

  /**
   * A re-run of a job whose attempt stalled (a worker died mid-attempt): the CV is still
   * `generating`, which is no move of the machine, so the new attempt takes it over in place.
   */
  async resumeGenerating(cvId: string, changes: StatusChanges): Promise<boolean> {
    const rows = await this.db
      .update(cvs)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(and(eq(cvs.id, cvId), eq(cvs.status, 'generating')))
      .returning({ id: cvs.id })
    return rows.length > 0
  }

  /**
   * The progress step of a generating CV. Not a move of the status: written only while the CV is
   * `generating`, so a late write can't touch a CV that has moved on. `false` when it had.
   */
  async setStage(cvId: string, stage: GenerationStage): Promise<boolean> {
    return this.resumeGenerating(cvId, { stage })
  }
}

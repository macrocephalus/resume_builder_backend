import type { CvData, Requirement } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { TransactionRollbackError, eq, sql } from 'drizzle-orm'
import { CvStatusService } from '../cvs/cv-status.service'
import { DATABASE, type Database } from '../database/database.module'
import { type Verification, cvQuestions, cvs } from '../database/schema'
import type { NewQuestion } from '../questions/new-question'
import { type AttemptOutcome, closeAttempt } from './attempt-log'

export type DraftToSave = {
  cvId: string
  attemptId: string
  data: CvData
  /** In the order they are asked; positions follow it. */
  questions: readonly NewQuestion[]
  requirements: readonly Requirement[]
  suggestedRoles: readonly string[]
  verification: Verification
  outcome: AttemptOutcome
}

/** Writes a finished attempt's draft (backend architecture §3, step 6). */
@Injectable()
export class DraftSaver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly statuses: CvStatusService,
  ) {}

  /**
   * One transaction: the move to `needs_input` (open questions) or `ready` by compare-and-set,
   * the draft and what comes with it, `version + 1`, the questions, the closed attempt row.
   * `false` when the CV is no longer `generating` (deleted, say): then nothing is written.
   */
  async save(draft: DraftToSave): Promise<boolean> {
    const to = draft.questions.length > 0 ? 'needs_input' : 'ready'
    try {
      await this.db.transaction(async (tx) => {
        const moved = await this.statuses.transition(draft.cvId, to, {
          changes: { stage: null },
          from: ['generating'],
          executor: tx,
        })
        if (!moved) tx.rollback()
        await tx
          .update(cvs)
          .set({
            data: draft.data,
            requirements: [...draft.requirements],
            suggestedRoles: [...draft.suggestedRoles],
            verification: draft.verification,
            version: sql`${cvs.version} + 1`,
          })
          .where(eq(cvs.id, draft.cvId))
        if (draft.questions.length > 0) {
          await tx.insert(cvQuestions).values(
            draft.questions.map((question, index) => ({
              ...question,
              cvId: draft.cvId,
              position: index + 1,
            })),
          )
        }
        await closeAttempt(draft.attemptId, 'succeeded', draft.outcome, tx)
      })
      return true
    } catch (error) {
      if (error instanceof TransactionRollbackError) return false
      throw error
    }
  }
}

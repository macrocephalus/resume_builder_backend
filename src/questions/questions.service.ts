import { randomUUID } from 'node:crypto'
import { type Cv, type Reply, cvDataSchema } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../common/errors/app-error'
import { CONTENT } from '../common/logging/logger-options'
import { CvStatusService } from '../cvs/cv-status.service'
import { type CvRow, requireDraft, toQuestion } from '../cvs/cv.mapper'
import { CvsService } from '../cvs/cvs.service'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvQuestions, cvs } from '../database/schema'
import { AnswerWordingService } from './answer-wording.service'
import { applyReplies } from './apply-replies'
import { type CheckedReply, checkReplies } from './check-replies'

/** Replies to questions (root `docs/architecture.md` §6.5, `docs/api.md` "Questions"). */
@Injectable()
export class QuestionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cvs: CvsService,
    private readonly statuses: CvStatusService,
    private readonly wording: AnswerWordingService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QuestionsService.name)
  }

  /**
   * Applies a batch of replies, all or none (`checkReplies`). The batch is checked once before
   * answer wording, so an invalid batch costs no model call, and again under the lock. One
   * transaction: the draft and the facts as `applyReplies` leaves them, each question `answered`
   * or `skipped`, one `version + 1`, `ready` once no question is left open. Answers the CV as the
   * batch left it.
   */
  async reply(userId: string, cvId: string, replies: readonly Reply[]): Promise<Cv> {
    const before = await this.cvs.getOwned(cvId, userId)
    const worded = await this.wording.word(before, await this.checked(before, replies, this.db))
    const updated = await this.db.transaction(async (tx) => {
      const cv = await this.cvs.lockOwned(cvId, userId, tx)
      const checked = await this.checked(cv, replies, tx)
      const { data, facts } = applyReplies(requireDraft(cv), cv.facts, checked, worded, randomUUID)
      for (const { question, answer } of checked) {
        await tx
          .update(cvQuestions)
          .set(
            answer === null
              ? { status: 'skipped' }
              : { status: 'answered', answer, answeredAt: sql`now()` },
          )
          .where(eq(cvQuestions.id, question.id))
      }
      await tx
        .update(cvs)
        .set({
          // applyAnswer keeps the draft within CV_LIMITS; a draft that still fails is a bug, 500
          data: cvDataSchema.parse(data),
          facts,
          version: sql`${cvs.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(cvs.id, cv.id))
      await this.statuses.readyIfNoneOpen(cv.id, tx)
      return this.cvs.get(userId, cv.id, tx)
    })
    this.logger.info(
      {
        cvId: updated.id,
        status: updated.status,
        version: updated.version,
        answered: replies.filter((reply) => reply.answer !== null).length,
        skipped: replies.filter((reply) => reply.answer === null).length,
        [CONTENT]: { replies },
      },
      'replies applied',
    )
    return updated
  }

  /** The batch checked against the CV and its questions as `executor` reads them. */
  private async checked(
    cv: CvRow,
    replies: readonly Reply[],
    executor: Executor,
  ): Promise<CheckedReply[]> {
    if (cv.status !== 'needs_input') {
      throw new AppError(409, 'INVALID_STATE', 'This CV is not waiting for answers.')
    }
    const rows = await executor
      .select()
      .from(cvQuestions)
      .where(
        and(
          eq(cvQuestions.cvId, cv.id),
          inArray(
            cvQuestions.id,
            replies.map((reply) => reply.questionId),
          ),
        ),
      )
    return checkReplies(
      replies,
      new Map(rows.map((row) => [row.id, toQuestion(row)])),
      requireDraft(cv),
    )
  }
}

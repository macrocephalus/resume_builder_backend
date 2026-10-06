import { randomUUID } from 'node:crypto'
import {
  type Answer,
  type Cv,
  type Question,
  SKIPPABLE_KINDS,
  answerSchemaFor,
  applyAnswer,
  cvDataSchema,
  targetExists,
} from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '../common/errors/app-error'
import { validationError } from '../common/errors/validation-error'
import { CvStatusService } from '../cvs/cv-status.service'
import { type CvRow, draftOf, toQuestion } from '../cvs/cv.mapper'
import { CvsService } from '../cvs/cvs.service'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvQuestions, cvs } from '../database/schema'
import { factOf } from './fact-of'

const uuid = z.uuid()

const notFound = () => new AppError(404, 'NOT_FOUND', 'This question does not exist.')

const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message)

type OpenQuestion = { cv: CvRow; question: Question }

/** Answer and skip (root `docs/architecture.md` §6.5, `docs/api.md` "Questions"). */
@Injectable()
export class QuestionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cvs: CvsService,
    private readonly statuses: CvStatusService,
  ) {}

  /**
   * Writes the answer into the draft as written (the shared `applyAnswer`) and keeps it as a fact
   * for later generations. One transaction: the draft, the fact, `version + 1`, the question
   * `answered`, and `ready` once no question is left open.
   */
  async answer(userId: string, cvId: string, questionId: string, body: Answer): Promise<Cv> {
    await this.db.transaction(async (tx) => {
      const { cv, question } = await this.openQuestion(userId, cvId, questionId, tx)
      if (body.kind !== question.kind) {
        throw invalidState(`This question takes a "${question.kind}" answer.`)
      }
      const parsed = answerSchemaFor(question).safeParse(body)
      if (!parsed.success) throw validationError(parsed.error)
      const answer = parsed.data
      const data = draftOf(cv)
      if (data === null) throw new Error(`CV ${cv.id} is needs_input without a draft`)
      if (!targetExists(data, question)) {
        throw invalidState('The part of the CV this question is about has been removed.')
      }
      await tx
        .update(cvs)
        .set({
          // applyAnswer keeps the draft within CV_LIMITS; a draft that still fails is a bug, 500
          data: cvDataSchema.parse(applyAnswer(data, question, answer, randomUUID)),
          facts: [...cv.facts, factOf(question, answer)],
          version: sql`${cvs.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(cvs.id, cv.id))
      await tx
        .update(cvQuestions)
        .set({ status: 'answered', answer, answeredAt: sql`now()` })
        .where(eq(cvQuestions.id, question.id))
      await this.statuses.readyIfNoneOpen(cv.id, tx)
    })
    return this.cvs.get(userId, cvId)
  }

  /** Closes a `text` / `choice` / `multi` question; the draft and its version stay as they are. */
  async skip(userId: string, cvId: string, questionId: string): Promise<Cv> {
    await this.db.transaction(async (tx) => {
      const { cv, question } = await this.openQuestion(userId, cvId, questionId, tx)
      if (!SKIPPABLE_KINDS.some((kind) => kind === question.kind)) {
        throw invalidState('A confirm question must be answered yes or no.')
      }
      await tx.update(cvQuestions).set({ status: 'skipped' }).where(eq(cvQuestions.id, question.id))
      await this.statuses.readyIfNoneOpen(cv.id, tx)
    })
    return this.cvs.get(userId, cvId)
  }

  /**
   * The CV, locked for the transaction, and its question, while the CV waits for answers and the
   * question is open; a question of another CV is `404` like a missing one.
   */
  private async openQuestion(
    userId: string,
    cvId: string,
    questionId: string,
    tx: Executor,
  ): Promise<OpenQuestion> {
    const cv = await this.cvs.lockOwned(cvId, userId, tx)
    if (!uuid.safeParse(questionId).success) throw notFound()
    const [row] = await tx
      .select()
      .from(cvQuestions)
      .where(and(eq(cvQuestions.id, questionId), eq(cvQuestions.cvId, cv.id)))
    if (!row) throw notFound()
    if (cv.status !== 'needs_input') throw invalidState('This CV is not waiting for answers.')
    if (row.status !== 'open') throw invalidState('This question has already been closed.')
    return { cv, question: toQuestion(row) }
  }
}

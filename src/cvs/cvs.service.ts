import type { CreateCvBody, Cv, CvStatusInfo, CvSummary } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '../common/errors/app-error'
import { GENERATION } from '../config/limits'
import { DATABASE, type Database } from '../database/database.module'
import { cvQuestions, cvs } from '../database/schema'
import { GenerationProducer } from '../generation/generation.producer'
import { LimitsService } from '../limits/limits.service'
import { type CvRow, toCv, toStatusInfo, toSummary } from './cv.mapper'
import { queuePositions } from './queue-position'

const uuid = z.uuid()

/** The list order: the most recently changed first (docs/api.md), ties by id. */
const NEWEST_FIRST = [desc(cvs.updatedAt), desc(cvs.id)]

/** Another user's CV is answered exactly like a missing one (docs/api.md "Conventions"). */
const notFound = () => new AppError(404, 'NOT_FOUND', 'This CV does not exist.')

@Injectable()
export class CvsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly limits: LimitsService,
    private readonly producer: GenerationProducer,
  ) {}

  /**
   * The only way to a CV: the row when `userId` owns it, else `404` (also for an id that is not
   * a UUID, which can't exist).
   */
  async getOwned(id: string, userId: string): Promise<CvRow> {
    if (!uuid.safeParse(id).success) throw notFound()
    const [row] = await this.db
      .select()
      .from(cvs)
      .where(and(eq(cvs.id, id), eq(cvs.userId, userId)))
    if (!row) throw notFound()
    return row
  }

  /**
   * A queued CV and its generation job, written in one transaction after the limits pass; then
   * the job goes on the queue. Answers at once: the generation runs in the worker.
   */
  async create(userId: string, body: CreateCvBody): Promise<Cv> {
    if (body.fromCvId !== undefined || body.sourceText === undefined) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', {
        fields: { fromCvId: 'Creating a CV for another role is not available yet' },
      })
    }
    const { sourceText } = body
    const { row, jobId } = await this.db.transaction(async (tx) => {
      await this.limits.assertCanStart(userId, tx)
      const [created] = await tx
        .insert(cvs)
        .values({
          userId,
          title: body.targetRole,
          targetRole: body.targetRole,
          roleContext: body.roleContext ?? null,
          language: body.language,
          sourceType: body.sourceType,
          sourceFilename: body.sourceFilename ?? null,
          sourceText,
          status: 'queued',
          attempt: 1,
          maxAttempts: GENERATION.attempts,
        })
        .returning()
      if (!created) throw new Error('cvs insert returned no row')
      return { row: created, jobId: await this.producer.recordJob(created, tx) }
    })
    await this.producer.enqueue(jobId, row.id)
    return toCv(row, [], await this.queuePositionOf(row))
  }

  /** The user's CVs, the most recently changed first. */
  async list(userId: string): Promise<CvSummary[]> {
    const rows = await this.db
      .select({
        ...getTableColumns(cvs),
        openQuestions: sql<number>`(
          select count(*) from ${cvQuestions}
          where ${cvQuestions.cvId} = ${cvs.id} and ${cvQuestions.status} = 'open'
        )`.mapWith(Number),
      })
      .from(cvs)
      .where(eq(cvs.userId, userId))
      .orderBy(...NEWEST_FIRST)
    return rows.map(({ openQuestions, ...row }) => toSummary(row, openQuestions))
  }

  /** The polled part of the user's CVs among `ids`; unknown and foreign ids are left out. */
  async statuses(userId: string, ids: readonly string[]): Promise<CvStatusInfo[]> {
    const rows = await this.db
      .select()
      .from(cvs)
      .where(and(eq(cvs.userId, userId), inArray(cvs.id, [...ids])))
      .orderBy(...NEWEST_FIRST)
    const positions = await queuePositions(
      rows.filter((row) => row.status === 'queued').map((row) => row.id),
      this.db,
    )
    return rows.map((row) => toStatusInfo(row, positions.get(row.id) ?? null))
  }

  async get(userId: string, id: string): Promise<Cv> {
    const row = await this.getOwned(id, userId)
    const questions = await this.db.select().from(cvQuestions).where(eq(cvQuestions.cvId, row.id))
    return toCv(row, questions, await this.queuePositionOf(row))
  }

  /**
   * In any status. Questions go with the CV; its generation jobs stay (they count toward the
   * hourly limit) with `cv_id` null, and a generation still running finds no row to save into.
   */
  async delete(userId: string, id: string): Promise<void> {
    const row = await this.getOwned(id, userId)
    await this.db.delete(cvs).where(and(eq(cvs.id, row.id), eq(cvs.userId, userId)))
  }

  private async queuePositionOf(row: CvRow): Promise<number | null> {
    if (row.status !== 'queued') return null
    return (await queuePositions([row.id], this.db)).get(row.id) ?? null
  }
}

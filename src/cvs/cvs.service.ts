import {
  CV_STATUSES,
  type CreateCvBody,
  type Cv,
  type CvStatus,
  type CvStatusInfo,
  type CvSummary,
  type PatchCvBody,
  hasDraft,
  isInProgress,
} from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '../common/errors/app-error'
import { GENERATION } from '../config/limits'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvQuestions, cvs, generationJobs } from '../database/schema'
import { GenerationProducer } from '../generation/generation.producer'
import { LimitsService } from '../limits/limits.service'
import { CvStatusService } from './cv-status.service'
import { type CvRow, toCv, toStatusInfo, toSummary } from './cv.mapper'
import { patchCv } from './patch-cv'
import { queuePositions } from './queue-position'

const uuid = z.uuid()

const IN_PROGRESS = CV_STATUSES.filter(isInProgress)

/** The list order: the most recently changed first (docs/api.md), ties by id. */
const NEWEST_FIRST = [desc(cvs.updatedAt), desc(cvs.id)]

/** Another user's CV is answered exactly like a missing one (docs/api.md "Conventions"). */
const notFound = () => new AppError(404, 'NOT_FOUND', 'This CV does not exist.')

const notEditable = () =>
  new AppError(409, 'INVALID_STATE', 'Only a CV with a finished draft can be edited.')

/** The editor opened an older version (another tab saved since): "reload latest". */
const versionConflict = (currentVersion: number) =>
  new AppError(409, 'VERSION_CONFLICT', 'The CV was changed elsewhere.', { currentVersion })

const notRetryable = () =>
  new AppError(409, 'INVALID_STATE', 'Only a CV whose generation failed can be retried.')

@Injectable()
export class CvsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly limits: LimitsService,
    private readonly producer: GenerationProducer,
    private readonly statusService: CvStatusService,
  ) {}

  /**
   * The only way to a CV: the row when `userId` owns it, else `404` (also for an id that is not
   * a UUID, which can't exist).
   */
  async getOwned(id: string, userId: string, executor: Executor = this.db): Promise<CvRow> {
    const [row] = await this.ownedRow(id, userId, executor)
    if (!row) throw notFound()
    return row
  }

  /**
   * `getOwned` inside the caller's transaction, the row locked until it ends, so two writes
   * that each start from what they read (two answers at once) run one after the other.
   */
  async lockOwned(id: string, userId: string, tx: Executor): Promise<CvRow> {
    const [row] = await this.ownedRow(id, userId, tx).for('update')
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

  /**
   * Starts the generation of a failed CV again, from attempt 1, with its stored source and facts:
   * a new job (counted like a new CV) in the transaction that moves it back to `queued`.
   */
  async retry(userId: string, id: string): Promise<Cv> {
    const row = await this.getOwned(id, userId)
    if (row.status !== 'failed') throw notRetryable()
    const jobId = await this.db.transaction(async (tx) => {
      await this.limits.assertCanStart(userId, tx)
      const moved = await this.statusService.transition(row.id, 'queued', {
        changes: { attempt: 1, stage: null, errorCode: null, error: null },
        executor: tx,
      })
      // another request retried it first
      if (!moved) throw notRetryable()
      return this.producer.recordJob(row, tx)
    })
    await this.producer.enqueue(jobId, row.id)
    return this.get(userId, row.id)
  }

  /**
   * A manual edit (docs/api.md, `PATCH /api/cvs/:id`): the title, the whole draft or both, from
   * the version the editor was opened at. One transaction: the edit, `version + 1`, the open
   * questions about removed items skipped, and `ready` once none is left open. Answers the CV as
   * this edit left it, read before the lock is released.
   */
  async edit(userId: string, id: string, body: PatchCvBody): Promise<Cv> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockOwned(id, userId, tx)
      if (!hasDraft(row.status)) throw notEditable()
      if (body.version !== row.version) {
        throw versionConflict(row.version)
      }
      const patched =
        body.data === undefined
          ? undefined
          : patchCv(body.data, await this.openQuestionsOf(row.id, tx))
      await tx
        .update(cvs)
        .set({
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(patched === undefined ? {} : { data: patched.data }),
          version: sql`${cvs.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(cvs.id, row.id))
      if (patched !== undefined && patched.toSkip.length > 0) {
        await tx
          .update(cvQuestions)
          .set({ status: 'skipped' })
          .where(inArray(cvQuestions.id, patched.toSkip))
        await this.statusService.readyIfNoneOpen(row.id, tx)
      }
      return this.get(userId, row.id, tx)
    })
  }

  /** The whole CV; inside a transaction that changed it, as that transaction left it. */
  async get(userId: string, id: string, executor: Executor = this.db): Promise<Cv> {
    const row = await this.getOwned(id, userId, executor)
    const questions = await executor.select().from(cvQuestions).where(eq(cvQuestions.cvId, row.id))
    return toCv(row, questions, await this.queuePositionOf(row, executor))
  }

  /**
   * In any status. Questions go with the CV; its generation jobs stay (they count toward the
   * hourly limit) with `cv_id` null, and a generation still running finds no row to save into.
   */
  async delete(userId: string, id: string): Promise<void> {
    const row = await this.getOwned(id, userId)
    await this.db.delete(cvs).where(and(eq(cvs.id, row.id), eq(cvs.userId, userId)))
  }

  /**
   * The newest job of every CV in progress, of all users: what the worker's queue recovery checks
   * against BullMQ. An older job of a CV was replaced by a Retry.
   */
  async latestJobsInProgress(): Promise<Array<{ jobId: string; cvId: string; status: CvStatus }>> {
    return this.db
      .selectDistinctOn([cvs.id], { jobId: generationJobs.id, cvId: cvs.id, status: cvs.status })
      .from(cvs)
      .innerJoin(generationJobs, eq(generationJobs.cvId, cvs.id))
      .where(inArray(cvs.status, IN_PROGRESS))
      .orderBy(cvs.id, desc(generationJobs.createdAt))
  }

  private openQuestionsOf(cvId: string, executor: Executor) {
    return executor
      .select({ id: cvQuestions.id, target: cvQuestions.target })
      .from(cvQuestions)
      .where(and(eq(cvQuestions.cvId, cvId), eq(cvQuestions.status, 'open')))
  }

  /** The query for the CV `userId` owns with this id; `404` for an id that is not a UUID. */
  private ownedRow(id: string, userId: string, executor: Executor) {
    if (!uuid.safeParse(id).success) throw notFound()
    return executor
      .select()
      .from(cvs)
      .where(and(eq(cvs.id, id), eq(cvs.userId, userId)))
  }

  private async queuePositionOf(row: CvRow, executor: Executor = this.db): Promise<number | null> {
    if (row.status !== 'queued') return null
    return (await queuePositions([row.id], executor)).get(row.id) ?? null
  }
}

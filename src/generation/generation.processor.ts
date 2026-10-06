import { randomUUID } from 'node:crypto'
import type { GenerationStage } from '@cv/shared'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { LanguageModel } from 'ai'
import { type Job, Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { type DraftRun, runDraftAgent } from '../agents/draft/draft.agent'
import { LANGUAGE_MODEL, modelIdOf } from '../agents/llm'
import { PROMPT_VERSION } from '../agents/prompt/prompt-builder'
import { AppError } from '../common/errors/app-error'
import { safeError } from '../common/logging/safe-error'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import type { CvRow } from '../cvs/cv.mapper'
import { CvStatusService } from '../cvs/cv-status.service'
import { CvsService } from '../cvs/cvs.service'
import { DATABASE, type Database } from '../database/database.module'
import { generationJobs } from '../database/schema'
import { REDIS } from '../redis/redis.module'
import { type AttemptOutcome, closeAttempt, closeStalledAttempts, openAttempt } from './attempt-log'
import { type GenerationErrorCode, failure } from './generation-errors'
import {
  GENERATION_LOCK_MS,
  GENERATION_QUEUE_NAME,
  type GenerationJobData,
} from './generation.queue'
import { prepareDraft } from './prepare-draft'
import { DraftSaver } from './save-draft'

/**
 * The worker's BullMQ processor for the generation queue (backend architecture §1, §3): one run
 * of a job is one attempt of a generation. The CV and its owner come from the job row, never from
 * the job's data, and every write is a compare-and-set, so a re-run job is harmless.
 */
@Injectable()
export class GenerationProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker: Worker<GenerationJobData> | null = null

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(LANGUAGE_MODEL) private readonly model: LanguageModel,
    @Inject(DATABASE) private readonly db: Database,
    private readonly cvs: CvsService,
    private readonly statuses: CvStatusService,
    private readonly saver: DraftSaver,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationProcessor.name)
  }

  onApplicationBootstrap(): void {
    this.worker = new Worker<GenerationJobData>(GENERATION_QUEUE_NAME, (job) => this.process(job), {
      connection: this.redis,
      prefix: this.env.QUEUE_PREFIX,
      concurrency: this.env.WORKER_CONCURRENCY,
      lockDuration: GENERATION_LOCK_MS,
    })
    this.worker.on('error', (err) => this.logger.error({ err }, 'generation worker error'))
  }

  /**
   * Doesn't wait out a running attempt: its job is then stalled, BullMQ runs it again and the new
   * attempt takes the CV over (`begin`).
   */
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(true)
  }

  private async process(job: Job<GenerationJobData>): Promise<void> {
    const jobId = job.id
    if (jobId === undefined) {
      this.logger.warn('generation job without an id; skipped')
      return
    }
    const cv = await this.cvOf(jobId)
    if (!cv) {
      this.logger.info({ jobId }, 'generation job without its CV; nothing to do')
      return
    }
    // BullMQ counts the runs that failed; failing and retrying an attempt comes with ticket 07
    const attempt = job.attemptsMade + 1
    const ids = { cvId: cv.id, jobId, attempt }
    if (!(await this.begin(cv.id, jobId, attempt))) {
      this.logger.info(ids, 'CV not waiting for a generation; job ends')
      return
    }
    this.logger.info(ids, 'generation attempt started')

    const startedAt = Date.now()
    let attemptId: string | null = null
    let run: DraftRun | null = null
    const outcomeOf = (error?: string): AttemptOutcome => ({
      steps: run?.steps ?? null,
      usage: run?.usage ?? null,
      durationMs: Date.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    })

    try {
      attemptId = await openAttempt(
        { jobId, attempt, model: modelIdOf(this.model), promptVersion: PROMPT_VERSION },
        this.db,
      )
      run = await runDraftAgent(
        this.model,
        {
          source: cv.sourceText,
          facts: cv.facts,
          targetRole: cv.targetRole,
          roleContext: cv.roleContext,
          language: cv.language,
          today: new Date(),
        },
        (stage) => this.setStage(cv.id, stage),
      )
      if (run.submission === null) {
        await this.fail(cv.id, attemptId, 'LLM_INVALID_OUTPUT', outcomeOf('no valid submission'))
        this.logger.warn({ ...ids, steps: run.steps }, 'no valid submit_draft; CV failed')
        return
      }
      const draft = prepareDraft(
        run.submission,
        { source: cv.sourceText, facts: cv.facts, language: cv.language },
        randomUUID,
      )
      await this.setStage(cv.id, 'saving')
      const saved = await this.saver.save({
        cvId: cv.id,
        attemptId,
        ...draft,
        outcome: outcomeOf(),
      })
      if (!saved) {
        await closeAttempt(attemptId, 'failed', outcomeOf('discarded: the CV moved on'), this.db)
        this.logger.info(ids, 'CV changed or deleted during the attempt; draft discarded')
        return
      }
      this.logger.info({ ...ids, steps: run.steps }, 'draft saved')
    } catch (err) {
      // the classification of model errors and their retries come with ticket 07
      const error = safeError(err)
      this.logger.error({ ...ids, err: error }, 'generation attempt failed')
      try {
        await this.fail(cv.id, attemptId, 'INTERNAL', outcomeOf(`${error.name}: ${error.message}`))
      } catch (failErr) {
        this.logger.error(
          { ...ids, err: safeError(failErr) },
          'failure not recorded; the CV stays generating until recovery',
        )
      }
    }
  }

  /** The job's CV, through its owner from the job row: `null` once deleted. */
  private async cvOf(jobId: string): Promise<CvRow | null> {
    const [job] = await this.db
      .select({ cvId: generationJobs.cvId, userId: generationJobs.userId })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
    if (!job?.cvId) return null
    try {
      return await this.cvs.getOwned(job.cvId, job.userId)
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return null
      throw error
    }
  }

  /**
   * Moves the CV into `generating` for this attempt. A re-run of this job after a stalled attempt
   * finds it there already: it takes it over and closes the stalled attempt's row.
   */
  private async begin(cvId: string, jobId: string, attempt: number): Promise<boolean> {
    const changes = { attempt, stage: 'drafting', errorCode: null, error: null } as const
    if (await this.statuses.transition(cvId, 'generating', { changes })) return true
    if (!(await this.statuses.resumeGenerating(cvId, changes))) return false
    await closeStalledAttempts(jobId, this.db)
    return true
  }

  private async fail(
    cvId: string,
    attemptId: string | null,
    code: GenerationErrorCode,
    outcome: AttemptOutcome,
  ): Promise<void> {
    const moved = await this.db.transaction(async (tx) => {
      const changed = await this.statuses.transition(cvId, 'failed', {
        changes: failure(code),
        from: ['generating'],
        executor: tx,
      })
      if (attemptId !== null) await closeAttempt(attemptId, 'failed', outcome, tx)
      return changed
    })
    if (!moved) this.logger.info({ cvId, code }, 'CV moved on before its failure was recorded')
  }

  /** Progress text only: a failed write is logged and the attempt goes on. */
  private async setStage(cvId: string, stage: GenerationStage): Promise<void> {
    try {
      await this.statuses.setStage(cvId, stage)
    } catch (err) {
      this.logger.warn({ cvId, stage, err: safeError(err) }, 'stage not written')
    }
  }
}

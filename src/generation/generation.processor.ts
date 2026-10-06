import { randomUUID } from 'node:crypto'
import type { GenerationStage } from '@cv/shared'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import type { LanguageModel } from 'ai'
import { type Job, UnrecoverableError, Worker } from 'bullmq'
import { desc, eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { type DraftRun, type DraftStep, runDraftAgent } from '../agents/draft/draft.agent'
import { LANGUAGE_MODEL, modelIdOf } from '../agents/llm'
import { PROMPT_VERSION } from '../agents/prompt/prompt-builder'
import { AppError } from '../common/errors/app-error'
import { CONTENT } from '../common/logging/logger-options'
import { safeError } from '../common/logging/safe-error'
import { ENV } from '../config/config.module'
import { GENERATION } from '../config/limits'
import type { Env } from '../config/env.schema'
import type { CvRow } from '../cvs/cv.mapper'
import { CvStatusService } from '../cvs/cv-status.service'
import { CvsService } from '../cvs/cvs.service'
import { DATABASE, type Database } from '../database/database.module'
import { generationJobs } from '../database/schema'
import { REDIS } from '../redis/redis.module'
import {
  type AttemptOutcome,
  closeAttempt,
  closeStalledAttempts,
  openAttempt,
  tokensOf,
} from './attempt-log'
import { NoValidSubmissionError, classifyError } from './classify-error'
import { type GenerationErrorCode, failure } from './generation-errors'
import {
  GENERATION_QUEUE_NAME,
  GENERATION_TIMING,
  type GenerationJobData,
  type GenerationTiming,
} from './generation.queue'
import { prepareDraft } from './prepare-draft'
import { DraftSaver } from './save-draft'

/** Where a failed attempt moves its CV. */
type NextStatus = { to: 'retrying' } | { to: 'failed'; code: GenerationErrorCode }

/** What every line about an attempt carries. */
type AttemptIds = { cvId: string; jobId: string; attempt: number }

/** The attempt a failure is recorded for. */
type AttemptRef = AttemptIds & { attemptId: string | null; lastAttempt: boolean }

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
    @Inject(GENERATION_TIMING) private readonly timing: GenerationTiming,
    private readonly cvs: CvsService,
    private readonly statuses: CvStatusService,
    private readonly saver: DraftSaver,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationProcessor.name)
  }

  onApplicationBootstrap(): void {
    this.worker = new Worker<GenerationJobData>(
      GENERATION_QUEUE_NAME,
      (job) =>
        // every line of the job, also those of the services it calls, carries the job id and
        // the attempt; the CV id each line names itself (the status service's lines do)
        this.logger.runInContext(() => this.process(job), { bindings: { jobId: job.id } }),
      {
        connection: this.redis,
        prefix: this.env.QUEUE_PREFIX,
        concurrency: this.env.WORKER_CONCURRENCY,
        lockDuration: GENERATION.lockMs,
      },
    )
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
      this.logger.info('generation job without its CV; nothing to do')
      return
    }
    // BullMQ counts the runs that failed; a stalled run is not counted, so its re-run keeps it
    const attempt = job.attemptsMade + 1
    const lastAttempt = attempt >= (job.opts.attempts ?? 1)
    const ids: AttemptIds = { cvId: cv.id, jobId, attempt }
    this.logger.assign({ attempt })
    if (!(await this.begin(cv.id, jobId, attempt))) {
      this.logger.info({ cvId: cv.id }, 'CV not waiting for a generation; job ends')
      return
    }
    const model = modelIdOf(this.model)
    this.logger.info(
      { cvId: cv.id, model, promptVersion: PROMPT_VERSION },
      'generation attempt started',
    )

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
        { jobId, attempt, model, promptVersion: PROMPT_VERSION },
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
        {
          onStage: (stage) => this.setStage(cv.id, stage),
          onPrompt: (message) =>
            this.logger.debug({ cvId: cv.id, [CONTENT]: { prompt: message } }, 'prompt built'),
          onStep: (step) => this.logStep(cv.id, step),
        },
        this.timing.agent,
      )
      if (run.submission === null) throw new NoValidSubmissionError(run.steps)
      const draft = prepareDraft(
        run.submission,
        { source: cv.sourceText, facts: cv.facts, language: cv.language },
        randomUUID,
      )
      await this.setStage(cv.id, 'saving')
      const status = await this.saver.save({
        cvId: cv.id,
        attemptId,
        ...draft,
        outcome: outcomeOf(),
      })
      if (status === null) {
        await closeAttempt(attemptId, 'failed', outcomeOf('discarded: the CV moved on'), this.db)
        this.logger.info(
          { cvId: cv.id },
          'CV changed or deleted during the attempt; draft discarded',
        )
        return
      }
      this.logger.info(
        {
          cvId: cv.id,
          status,
          questions: draft.questions.length,
          verification: draft.verification,
          steps: run.steps,
          tokens: tokensOf(run.usage),
          durationMs: Date.now() - startedAt,
        },
        'draft saved',
      )
    } catch (err) {
      await this.failAttempt(err, { ...ids, attemptId, lastAttempt }, outcomeOf)
    }
  }

  /**
   * A failed attempt: its row is closed and the CV moved on by `classifyError`, then the error
   * BullMQ acts on is thrown — a plain one to run the next attempt after the backoff, an
   * `UnrecoverableError` to stop. Returns only when the CV had moved on already (deleted).
   */
  private async failAttempt(
    err: unknown,
    { attemptId, lastAttempt, ...ids }: AttemptRef,
    outcomeOf: (error: string) => AttemptOutcome,
  ): Promise<void> {
    const error = safeError(err)
    const { code, retryable } = classifyError(err)
    const retry = retryable && !lastAttempt
    this.logger.warn({ cvId: ids.cvId, err: error, code, retry }, 'generation attempt failed')
    let moved: boolean
    try {
      moved = await this.recordFailure(
        ids.cvId,
        attemptId,
        retry ? { to: 'retrying' } : { to: 'failed', code },
        outcomeOf(`${error.name}: ${error.message}`),
      )
    } catch (recordErr) {
      this.logger.error({ cvId: ids.cvId, err: safeError(recordErr) }, 'failure not recorded')
      throw new Error(`attempt ${ids.attempt} failed: ${code}; failure not recorded`)
    }
    if (!moved) {
      this.logger.info({ cvId: ids.cvId }, 'CV moved on before its failure was recorded; job ends')
      return
    }
    // the error itself may quote the user's data, and BullMQ keeps what it is thrown in Redis
    if (retry) throw new Error(`attempt ${ids.attempt} failed: ${code}`)
    throw new UnrecoverableError(`generation failed: ${code}`)
  }

  /**
   * The job's CV, through its owner from the job row: `null` once deleted, and also when a later
   * job (a Retry) has replaced this one, so a stale job never runs next to it.
   */
  private async cvOf(jobId: string): Promise<CvRow | null> {
    const [job] = await this.db
      .select({ cvId: generationJobs.cvId, userId: generationJobs.userId })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
    if (!job?.cvId) return null
    const [latest] = await this.db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.cvId, job.cvId))
      .orderBy(desc(generationJobs.createdAt))
      .limit(1)
    if (latest?.id !== jobId) return null
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

  /**
   * Closes the attempt row and moves the CV on, together: to `retrying` (BullMQ runs the next
   * attempt) or to `failed` with the error code. `false` when the CV was no
   * longer `generating`. When the write fails the caller throws a plain error, so BullMQ runs the
   * job again and the next attempt takes the CV over; after the last one, recovery does.
   */
  private async recordFailure(
    cvId: string,
    attemptId: string | null,
    next: NextStatus,
    outcome: AttemptOutcome,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (attemptId !== null) await closeAttempt(attemptId, 'failed', outcome, tx)
      return this.statuses.transition(cvId, next.to, {
        changes: next.to === 'retrying' ? { stage: null } : failure(next.code),
        from: ['generating'],
        executor: tx,
      })
    })
  }

  /**
   * One agent step at debug: the verdict and the tokens; what the model sent and the problems
   * found in it (they quote the CV) as content.
   */
  private logStep(cvId: string, step: DraftStep): void {
    const problems = step.result?.accepted === false ? step.result.problems : []
    this.logger.debug(
      {
        cvId,
        step: step.number,
        finishReason: step.finishReason,
        accepted: step.result?.accepted ?? null,
        problems: problems.length,
        toolError: step.toolError !== null,
        tokens: tokensOf(step.usage),
        [CONTENT]: { text: step.text, input: step.input, problems, toolError: step.toolError },
      },
      'agent step',
    )
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

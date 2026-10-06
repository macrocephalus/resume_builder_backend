import { Inject, Injectable } from '@nestjs/common'
import type { JobState, Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { withTimeout } from '../common/async/with-timeout'
import { safeError } from '../common/logging/safe-error'
import { TIMEOUTS } from '../config/limits'
import type { Executor } from '../database/database.module'
import { generationJobs } from '../database/schema'
import { GENERATION_JOB_NAME, GENERATION_QUEUE, type GenerationJobData } from './generation.queue'

/** States of a job BullMQ will still run: waiting, delayed or running now. */
const LIVE: ReadonlySet<JobState | 'unknown'> = new Set([
  'waiting',
  'waiting-children',
  'prioritized',
  'delayed',
  'active',
])

/**
 * What became of a job, for the recovery: `live` (BullMQ will run it), `failed` (BullMQ gave up
 * on it) or `gone` (done, or a Redis that doesn't have it).
 */
export type JobFate = 'live' | 'failed' | 'gone'

/**
 * Starts a generation in two steps: the job row is written in the caller's transaction (with the
 * CV it belongs to), then, after the commit, the job is put on the queue. Postgres is the source
 * of truth: a job that never reached Redis is put back by the worker's recovery.
 */
@Injectable()
export class GenerationProducer {
  constructor(
    @Inject(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GenerationProducer.name)
  }

  /** Writes the `generation_jobs` row; its id is the BullMQ jobId. The owner comes from the CV. */
  async recordJob(cv: { id: string; userId: string }, executor: Executor): Promise<string> {
    const [job] = await executor
      .insert(generationJobs)
      .values({ cvId: cv.id, userId: cv.userId })
      .returning({ id: generationJobs.id })
    if (!job) throw new Error('generation_jobs insert returned no row')
    return job.id
  }

  /**
   * Puts a committed job on the queue. Never fails the request: when Redis is down or slow the
   * error is logged and recovery adds the job later (same jobId, so never twice).
   */
  async enqueue(jobId: string, cvId: string): Promise<void> {
    try {
      await withTimeout(
        this.queue.add(GENERATION_JOB_NAME, { cvId }, { jobId }),
        TIMEOUTS.enqueueMs,
        'adding a generation job',
      )
      this.logger.debug({ cvId, jobId }, 'generation job queued')
    } catch (err) {
      this.logger.error(
        { err: safeError(err), cvId, jobId },
        'generation job not queued; recovery will add it',
      )
    }
  }

  async fateOf(jobId: string): Promise<JobFate> {
    const state = await withTimeout(
      this.queue.getJobState(jobId),
      TIMEOUTS.enqueueMs,
      'reading a generation job',
    )
    if (LIVE.has(state)) return 'live'
    return state === 'failed' ? 'failed' : 'gone'
  }

  /**
   * Recovery: puts a job that is not live back on the queue. One BullMQ still stores (finished)
   * is removed first, since its jobId would make the new one a duplicate.
   */
  async requeue(jobId: string, cvId: string): Promise<void> {
    await withTimeout(
      (async () => {
        await this.queue.remove(jobId)
        await this.queue.add(GENERATION_JOB_NAME, { cvId }, { jobId })
      })(),
      TIMEOUTS.enqueueMs,
      'putting a generation job back',
    )
  }
}

import type { DefaultJobOptions } from 'bullmq'
import { GENERATION } from '../config/limits'

/** Injection token for the BullMQ `Queue<GenerationJobData>` of generation jobs. */
export const GENERATION_QUEUE = Symbol('GENERATION_QUEUE')

export const GENERATION_QUEUE_NAME = 'generation'
export const GENERATION_JOB_NAME = 'generate'

/**
 * What a queued job carries. The BullMQ jobId is the `generation_jobs` row id; the worker reads
 * the CV and its owner from Postgres, never from here. `cvId` is for logs.
 */
export type GenerationJobData = { cvId: string }

/**
 * BullMQ retries a failed attempt itself: 3 attempts, 5 s, 10 s apart (backend architecture §5).
 * A finished job leaves Redis; a failed one stays a day for debugging.
 */
export const GENERATION_JOB_OPTIONS = {
  attempts: GENERATION.attempts,
  backoff: { type: 'exponential', delay: GENERATION.backoffMs },
  removeOnComplete: true,
  removeOnFail: { age: GENERATION.failedJobKeepSeconds },
} as const satisfies DefaultJobOptions

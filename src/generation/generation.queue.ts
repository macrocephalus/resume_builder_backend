import type { DefaultJobOptions } from 'bullmq'
import type { DraftAgentTimeouts } from '../agents/draft/draft.agent'
import { DRAFT_AGENT_LIMITS } from '../agents/draft/draft.limits'
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
 * The waits of a generation, behind a token so the e2e tests can shorten them; everywhere else
 * it is `GENERATION_TIMING_DEFAULTS`.
 */
export const GENERATION_TIMING = Symbol('GENERATION_TIMING')

export type GenerationTiming = {
  /** First delay between attempts; BullMQ doubles it each time. */
  backoffMs: number
  /** The bounds of one attempt of the DraftAgent. */
  agent: DraftAgentTimeouts
  /** Period of the worker's queue recovery. */
  recoveryMs: number
}

export const GENERATION_TIMING_DEFAULTS: GenerationTiming = {
  backoffMs: GENERATION.backoffMs,
  agent: { stepMs: DRAFT_AGENT_LIMITS.stepMs, totalMs: DRAFT_AGENT_LIMITS.totalMs },
  recoveryMs: GENERATION.recoveryMs,
}

/**
 * BullMQ retries a failed attempt itself: 3 attempts, 5 s, 10 s apart (backend architecture §5).
 * A finished job leaves Redis; a failed one stays a day for debugging.
 */
export const generationJobOptions = ({ backoffMs }: GenerationTiming) =>
  ({
    attempts: GENERATION.attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: true,
    removeOnFail: { age: GENERATION.failedJobKeepSeconds },
  }) satisfies DefaultJobOptions

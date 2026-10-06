import type { LanguageModelUsage } from 'ai'
import { and, eq, sql } from 'drizzle-orm'
import type { Executor } from '../database/database.module'
import { type AttemptStatus, generationAttempts } from '../database/schema'

/** What one attempt cost, from the agent's run. */
export type AttemptOutcome = {
  steps: number | null
  usage: LanguageModelUsage | null
  durationMs: number
  error?: string
}

/** A run's token counts, as the attempt row and the logs keep them. */
export const tokensOf = (usage: LanguageModelUsage) => ({
  input: usage.inputTokens ?? null,
  output: usage.outputTokens ?? null,
  cacheRead: usage.inputTokenDetails.cacheReadTokens ?? null,
  cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? null,
})

/** Opens the audit row of an attempt; nothing is read back from it for behaviour. */
export const openAttempt = async (
  values: { jobId: string; attempt: number; model: string; promptVersion: string },
  executor: Executor,
): Promise<string> => {
  const [row] = await executor
    .insert(generationAttempts)
    .values(values)
    .returning({ id: generationAttempts.id })
  if (!row) throw new Error('generation_attempts insert returned no row')
  return row.id
}

export const closeAttempt = async (
  attemptId: string,
  status: Exclude<AttemptStatus, 'running'>,
  { steps, usage, durationMs, error }: AttemptOutcome,
  executor: Executor,
): Promise<void> => {
  const tokens = usage === null ? null : tokensOf(usage)
  await executor
    .update(generationAttempts)
    .set({
      status,
      agentSteps: steps,
      inputTokens: tokens?.input ?? null,
      outputTokens: tokens?.output ?? null,
      cacheReadTokens: tokens?.cacheRead ?? null,
      cacheWriteTokens: tokens?.cacheWrite ?? null,
      durationMs,
      error: error ?? null,
      finishedAt: sql`now()`,
    })
    .where(eq(generationAttempts.id, attemptId))
}

/** The attempt rows of a job left `running` by a worker that died: closed as `failed`. */
export const closeStalledAttempts = async (jobId: string, executor: Executor): Promise<void> => {
  await executor
    .update(generationAttempts)
    .set({ status: 'failed', error: 'stalled', finishedAt: sql`now()` })
    .where(and(eq(generationAttempts.jobId, jobId), eq(generationAttempts.status, 'running')))
}

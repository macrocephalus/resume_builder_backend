import type { GenerationStage } from '@cv/shared'
import {
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type StepResult,
  type SystemModelMessage,
  ToolLoopAgent,
  type UserModelMessage,
  isStepCount,
} from 'ai'
import { type PromptInput, buildPrompt } from '../prompt/prompt-builder'
import type { DraftSubmission } from './draft-submission.schema'
import { stopWhenAccepted } from './stop-when-accepted'
import {
  SUBMIT_DRAFT,
  type SubmitDraftResult,
  createSubmitDraftTool,
  verdictOf,
} from './tools/submit-draft.tool'

/** The bounds of one attempt (backend architecture §3). */
export const DRAFT_AGENT_LIMITS = {
  steps: 3,
  stepMs: 120_000,
  totalMs: 300_000,
  /** Retries of one step by the SDK (a short 529 on step 2 keeps step 1). */
  maxRetries: 2,
  maxOutputTokens: 16_000,
} as const

/** How long one step and one attempt may take; tests shorten them. */
export type DraftAgentTimeouts = { stepMs: number; totalMs: number }

/** Anthropic prompt caching: a breakpoint where it is set, and automatic for the whole request. */
const CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const

export type DraftRun = {
  /** The last schema-valid `submit_draft` input of any step; `null` when there was none. */
  submission: DraftSubmission | null
  steps: number
  usage: LanguageModelUsage
}

/** Progress for the UI. Hook errors are swallowed by the SDK, so the callback logs its own. */
export type OnStage = (stage: GenerationStage) => Promise<void>

/** One finished step of an attempt, for the logs. */
export type DraftStep = {
  /** From 1. */
  number: number
  finishReason: FinishReason
  usage: LanguageModelUsage
  /** What the model answered: its text and the `submit_draft` input as sent (valid or not). */
  text: string
  input: unknown
  /** The tool's verdict; else why it gave none (an input that failed the schema, say). */
  result: SubmitDraftResult | null
  toolError: string | null
}

/** What the caller hears of an attempt: the stages for the UI, the prompt and steps for the logs. */
export type DraftAgentHooks = {
  onStage: OnStage
  /** The user message of the attempt (the instructions are static: `PROMPT_VERSION`). */
  onPrompt?: (message: string) => void
  onStep?: (step: DraftStep) => void
}

type DraftTools = { [SUBMIT_DRAFT]: ReturnType<typeof createSubmitDraftTool> }

const stepOf = (step: StepResult<DraftTools>): DraftStep => {
  let input: unknown = null
  let result: SubmitDraftResult | null = null
  let toolError: string | null = null
  for (const part of step.content) {
    if (part.type === 'tool-call') input = part.input
    if (part.type === 'tool-result' && part.dynamic !== true) result = part.output
    if (part.type === 'tool-error') toolError = String(part.error)
  }
  return {
    number: step.stepNumber + 1,
    finishReason: step.finishReason,
    usage: step.usage,
    text: step.text,
    input,
    result,
    toolError,
  }
}

/**
 * One attempt of the DraftAgent: a `ToolLoopAgent` with the single tool `submit_draft`, built
 * per attempt (ADR 0003). Ends on an accepted submission, after 3 steps or on a step without a
 * tool call. Throws what the SDK throws (API errors, timeouts); the caller classifies them.
 */
export const runDraftAgent = async (
  model: LanguageModel,
  input: PromptInput,
  { onStage, onPrompt, onStep }: DraftAgentHooks,
  timeouts: DraftAgentTimeouts,
): Promise<DraftRun> => {
  const { instructions, message } = buildPrompt(input)
  onPrompt?.(message)
  const system: SystemModelMessage = {
    role: 'system',
    content: instructions,
    providerOptions: CACHE,
  }
  const user: UserModelMessage = { role: 'user', content: message, providerOptions: CACHE }

  const agent = new ToolLoopAgent({
    model,
    instructions: system,
    tools: { [SUBMIT_DRAFT]: createSubmitDraftTool({ source: input.source, facts: input.facts }) },
    // the model rejects forced tool use; the instructions require the tool instead
    toolChoice: 'auto',
    stopWhen: [stopWhenAccepted, isStepCount(DRAFT_AGENT_LIMITS.steps)],
    timeout: { stepMs: timeouts.stepMs, totalMs: timeouts.totalMs },
    maxRetries: DRAFT_AGENT_LIMITS.maxRetries,
    maxOutputTokens: DRAFT_AGENT_LIMITS.maxOutputTokens,
    providerOptions: CACHE,
    onStepStart: async ({ stepNumber }) => {
      if (stepNumber === 0) await onStage('drafting')
    },
    onToolExecutionStart: async () => {
      await onStage('verifying')
    },
    onStepEnd: async (step) => {
      onStep?.(stepOf(step))
      if (step.toolResults.some((result) => verdictOf(result.output) === false)) {
        await onStage('revising')
      }
    },
  })

  const result = await agent.generate({ messages: [user] })
  const submissions = result.steps
    .flatMap((step) => step.staticToolCalls)
    .filter((call) => call.toolName === SUBMIT_DRAFT)
  return {
    submission: submissions.at(-1)?.input ?? null,
    steps: result.steps.length,
    usage: result.totalUsage,
  }
}

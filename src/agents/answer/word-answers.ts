import { type LanguageModel, Output, generateText } from 'ai'
import { buildWordingPrompt } from '../prompt/answer-wording-prompt'
import {
  ANSWER_WORDING_LIMITS,
  type WordedAnswer,
  type WordingRequest,
  wordedAnswersSchema,
} from './answer-wording.schema'

/**
 * One call of the fast model that words every answer of `request` (root `docs/architecture.md`
 * §6.5, "Answer wording"): no tools, no loop, a structured output. Throws what the SDK throws
 * (API errors, a timeout, an output that fails the schema); the caller falls back to the answers
 * as written.
 */
export const wordAnswers = async (
  model: LanguageModel,
  request: WordingRequest,
  timeoutMs: number,
): Promise<WordedAnswer[]> => {
  const { instructions, message } = buildWordingPrompt(request)
  const { output } = await generateText({
    model,
    instructions,
    prompt: message,
    output: Output.object({ schema: wordedAnswersSchema }),
    timeout: timeoutMs,
    maxRetries: ANSWER_WORDING_LIMITS.maxRetries,
    maxOutputTokens: ANSWER_WORDING_LIMITS.maxOutputTokens,
  })
  return output.answers
}

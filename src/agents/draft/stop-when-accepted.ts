import type { StopCondition, ToolSet } from 'ai'
import { SUBMIT_DRAFT, verdictOf } from './tools/submit-draft.tool'

/** Ends the loop once the last step's `submit_draft` was accepted. */
export const stopWhenAccepted: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (result) => result.toolName === SUBMIT_DRAFT && verdictOf(result.output) === true,
    ) ?? false

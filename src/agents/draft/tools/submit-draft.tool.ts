import { tool } from 'ai'
import type { PromptFact } from '../../prompt/prompt-fact'
import { describeProblem, verifyDraft } from '../../verify/verify-draft'
import { type DraftSubmission, draftSubmissionSchema } from '../draft-submission.schema'

export const SUBMIT_DRAFT = 'submit_draft'

export const SUBMIT_DRAFT_DESCRIPTION = [
  'Submit the whole CV draft. This is the only way to answer.',
  'Send every block, with an evidence quote for each claim, the questions for what the source',
  'does not say, the requirements of the target role and up to three other suitable roles.',
  'The draft is checked against the source and the user facts: bullets by their quotes, names,',
  'dates, contacts and skills by the source text, the summary for numbers and technologies the',
  'source does not state, and the question targets.',
  'The result is { "accepted": true }, which ends the work, or { "accepted": false, "problems" },',
  'one line per path to fix before you submit the whole draft again. Calls are few: check the',
  'draft before the first one.',
].join(' ')

/** What the tool answers the model with. */
export type SubmitDraftResult = { accepted: true } | { accepted: false; problems: string[] }

/** `accepted` of a `submit_draft` result as the SDK reports it (`unknown`); else `undefined`. */
export const verdictOf = (output: unknown): boolean | undefined =>
  typeof output === 'object' &&
  output !== null &&
  'accepted' in output &&
  typeof output.accepted === 'boolean'
    ? output.accepted
    : undefined

/** The attempt's material the tool checks a submission against. */
export type SubmitDraftContext = { source: string; facts: readonly PromptFact[] }

/**
 * `submit_draft`, built per attempt. The input is validated by Zod before `execute`; an invalid
 * one is returned to the model as a tool error and the loop goes on. A valid one is verified
 * against the source and the facts: accepted, or one line per problem for the model to fix.
 */
export const createSubmitDraftTool = ({ source, facts }: SubmitDraftContext) =>
  tool({
    description: SUBMIT_DRAFT_DESCRIPTION,
    inputSchema: draftSubmissionSchema,
    execute: async (submission: DraftSubmission): Promise<SubmitDraftResult> => {
      const problems = verifyDraft(submission, source, facts)
      return problems.length === 0
        ? { accepted: true }
        : { accepted: false, problems: problems.map(describeProblem) }
    },
  })

import { createHash } from 'node:crypto'
import { type CvLanguage, getCvLanguage } from '@cv/shared'
import { z } from 'zod'
import { draftSubmissionSchema } from '../draft/draft-submission.schema'
import { SUBMIT_DRAFT_DESCRIPTION } from '../draft/tools/submit-draft.tool'
import { escapeTagContent } from './escape-tags'
import type { PromptFact } from './prompt-fact'
import { DRAFT_EXAMPLE, DRAFT_EXAMPLE_LANGUAGE, DRAFT_EXAMPLE_SOURCE } from './system/draft.example'
import { DRAFT_SYSTEM } from './system/draft.system'

export type PromptInput = {
  source: string
  facts: readonly PromptFact[]
  targetRole: string
  roleContext: string | null
  language: CvLanguage
  /** Taken as a UTC date. */
  today: Date
}

/** The rules and one example: identical for every CV, so they stay in the prompt cache. */
export const DRAFT_INSTRUCTIONS = `${DRAFT_SYSTEM}

# Example
One source and the submit_draft input that is accepted for it on the first call. The person is
made up; use none of its content. The CV is in ${DRAFT_EXAMPLE_LANGUAGE} and the source is not,
so translated values carry quotes in the source's language; values copied as written (the
company "Sample Pay", the skills) need none.
<example_source>
${DRAFT_EXAMPLE_SOURCE}
</example_source>
${JSON.stringify(DRAFT_EXAMPLE, null, 2)}`

/** Closes the user message: the task after the data it is about. Static, like the instructions. */
export const DRAFT_TASK =
  'Write the CV for <target_role> in <cv_language> from <source> and <user_facts>, following ' +
  '"How to work", and answer with one submit_draft call that passes "Before you submit".'

/**
 * A hash of everything static the model sees (instructions, the tool's description and schema),
 * stored on each attempt so a change of the prompt shows in the data.
 */
export const PROMPT_VERSION = createHash('sha256')
  .update(DRAFT_INSTRUCTIONS)
  .update(SUBMIT_DRAFT_DESCRIPTION)
  .update(JSON.stringify(z.toJSONSchema(draftSubmissionSchema)))
  .digest('hex')
  .slice(0, 12)

const tag = (name: string, content: string, block = false): string =>
  block
    ? `<${name}>\n${escapeTagContent(content)}\n</${name}>`
    : `<${name}>${escapeTagContent(content)}</${name}>`

const factsText = (facts: readonly PromptFact[]): string =>
  facts.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`).join('\n\n')

/**
 * `{ instructions, message }` for the DraftAgent (backend architecture §3): static first, user
 * data last, the long and stable tags before the short ones, every value escaped; the message
 * ends with the task.
 */
export const buildPrompt = (input: PromptInput): { instructions: string; message: string } => {
  const message = [
    tag('source', input.source, true),
    input.facts.length === 0
      ? tag('user_facts', '(none)')
      : tag('user_facts', factsText(input.facts), true),
    tag('target_role', input.targetRole),
    tag('role_context', input.roleContext ?? '(none)'),
    tag('cv_language', getCvLanguage(input.language).englishName),
    tag('today', input.today.toISOString().slice(0, 10)),
    '',
    DRAFT_TASK,
  ].join('\n')
  return { instructions: DRAFT_INSTRUCTIONS, message }
}

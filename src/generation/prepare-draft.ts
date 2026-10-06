import type { CvData, CvLanguage, Requirement } from '@cv/shared'
import type { DraftSubmission } from '../agents/draft/draft-submission.schema'
import type { PromptFact } from '../agents/prompt/prompt-fact'
import { sanitise } from '../agents/verify/sanitise'
import { verifyDraft } from '../agents/verify/verify-draft'
import type { Verification } from '../database/schema'
import { buildAutoQuestions } from '../questions/build-auto-questions'
import { buildVerifierQuestions, skillKey } from '../questions/build-verifier-questions'
import { type NewQuestion, questionTarget, targetKey } from '../questions/new-question'
import { selectQuestions } from '../questions/select-questions'
import { draftFromSubmission } from './draft-from-submission'

/** What the submission is checked against, and the language its questions are worded in. */
export type DraftContext = {
  source: string
  facts: readonly PromptFact[]
  language: CvLanguage
}

/** Everything a finished attempt saves, built without I/O from the last valid submission. */
export type PreparedDraft = {
  data: CvData
  questions: NewQuestion[]
  requirements: Requirement[]
  suggestedRoles: string[]
  verification: Verification
}

const bulletCount = (data: CvData): number =>
  [...data.experience, ...data.projects].reduce((count, item) => count + item.bullets.length, 0)

/**
 * The last valid submission of the loop as the draft to save (backend architecture §3, steps
 * 4–5): what still fails verification is taken out (`sanitise`), items get ids, and the questions
 * are the auto ones over the final draft, the verifier's and the model's, selected by priority.
 * The counts are what the user is told: bullets kept, and the claims, skills and cleared fields
 * actually asked about.
 */
export const prepareDraft = (
  submission: DraftSubmission,
  { source, facts, language }: DraftContext,
  newId: () => string,
): PreparedDraft => {
  const sanitised = sanitise(submission, verifyDraft(submission, source, facts))
  const { data, questions: model, itemIdOf } = draftFromSubmission(sanitised.submission, newId)
  const requirements = sanitised.submission.requirements.map((item) => ({ id: newId(), ...item }))
  const verifier = buildVerifierQuestions({
    data,
    ...sanitised,
    requirements,
    language,
    itemIdOf,
  })
  const questions = selectQuestions({
    auto: buildAutoQuestions(data, language),
    ...verifier,
    model,
  })

  // a cleared field counts once a question asks for it: the verifier's, or the auto one
  const asked = new Set(questions.map((question) => targetKey(question.target)))
  const clearedAndAsked = sanitised.cleared.filter((field) => {
    const itemId =
      field.section === 'contacts' ? undefined : itemIdOf(field.section, field.itemIndex)
    if (field.section !== 'contacts' && itemId === undefined) return false
    return asked.has(targetKey(questionTarget(field.section, itemId, field.field)))
  })
  const removedSkills = new Set(sanitised.skills.map(skillKey))
  const offered = questions.find((question) => question.kind === 'multi')?.options ?? []
  return {
    data,
    questions,
    requirements,
    suggestedRoles: sanitised.submission.suggestedRoles,
    verification: {
      verified: bulletCount(data),
      sentToConfirm: questions.filter((question) => question.kind === 'confirm').length,
      skillsToConfirm: offered.filter((option) => removedSkills.has(skillKey(option))).length,
      cleared: clearedAndAsked.length,
    },
  }
}

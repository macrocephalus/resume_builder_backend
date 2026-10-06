import type { CvData, CvLanguage, Requirement } from '@cv/shared'
import type { DraftSubmission } from '../agents/draft/draft-submission.schema'
import type { Verification } from '../database/schema'
import { buildAutoQuestions } from '../questions/build-auto-questions'
import type { NewQuestion } from '../questions/new-question'
import { selectQuestions } from '../questions/select-questions'
import { draftFromSubmission } from './draft-from-submission'

/** Everything a finished attempt saves, built without I/O from the accepted submission. */
export type PreparedDraft = {
  data: CvData
  questions: NewQuestion[]
  requirements: Requirement[]
  suggestedRoles: string[]
  verification: Verification
}

/** Until the verifier lands (ticket 06), every bullet counts as verified. */
const countBullets = (data: CvData): Verification => ({
  verified: [...data.experience, ...data.projects].reduce(
    (count, item) => count + item.bullets.length,
    0,
  ),
  sentToConfirm: 0,
  skillsToConfirm: 0,
  cleared: 0,
})

/**
 * The submission as a draft with ids, its questions (auto over the final draft, worded in the CV
 * language, then the model's), the requirements with ids and the counts shown in the editor.
 */
export const prepareDraft = (
  submission: DraftSubmission,
  language: CvLanguage,
  newId: () => string,
): PreparedDraft => {
  const { data, questions } = draftFromSubmission(submission, newId)
  return {
    data,
    questions: selectQuestions({ auto: buildAutoQuestions(data, language), model: questions }),
    requirements: submission.requirements.map((item) => ({ id: newId(), ...item })),
    suggestedRoles: submission.suggestedRoles,
    verification: countBullets(data),
  }
}

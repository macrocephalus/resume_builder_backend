import {
  type CvData,
  ITEM_SECTIONS,
  type ItemSection,
  cvDataSchema,
  dropEmptyItems,
} from '@cv/shared'
import type { DraftSubmission, SubmissionQuestion } from '../agents/draft/draft-submission.schema'
import { type NewQuestion, questionTarget } from '../questions/new-question'

/** The draft as it will be saved, and the model's questions with their targets resolved. */
export type DraftFromSubmission = { data: CvData; questions: NewQuestion[] }

const isItemSection = (section: string): section is ItemSection =>
  (ITEM_SECTIONS as readonly string[]).includes(section)

const withIds = (cv: DraftSubmission['cv'], newId: () => string): CvData => ({
  ...cv,
  experience: cv.experience.map((item) => ({ id: newId(), ...item })),
  projects: cv.projects.map((item) => ({ id: newId(), ...item })),
  education: cv.education.map((item) => ({ id: newId(), ...item })),
  certifications: cv.certifications.map((item) => ({ id: newId(), ...item })),
  languages: cv.languages.map((item) => ({ id: newId(), ...item })),
})

/** The question with its target resolved against `data`, or `null` when it points nowhere. */
const resolve = (question: SubmissionQuestion, data: CvData): NewQuestion | null => {
  const { section, itemIndex, field } = question.target
  let itemId: string | undefined
  if (itemIndex !== undefined) {
    if (!isItemSection(section)) return null
    itemId = data[section][itemIndex]?.id
    if (itemId === undefined) return null
  }
  const options = question.kind === 'choice' ? (question.options ?? []) : []
  const isChoice = options.length >= 2
  return {
    kind: isChoice ? 'choice' : 'text',
    origin: 'model',
    text: question.text,
    label: question.label,
    options: isChoice ? options : [],
    claim: null,
    target: questionTarget(section, itemId, field),
  }
}

const itemIdsOf = (data: CvData): Set<string> =>
  new Set(ITEM_SECTIONS.flatMap((section) => data[section].map((item) => item.id)))

/**
 * The model's submission as a draft: every item gets a UUID, question targets go from item index
 * to item id (a target that points nowhere drops the question), empty items and blank entries are
 * dropped (with the questions about them), and `CvData` checks the result as the last guard.
 */
export const draftFromSubmission = (
  submission: DraftSubmission,
  newId: () => string,
): DraftFromSubmission => {
  const identified = withIds(submission.cv, newId)
  const resolved = submission.questions
    .map((question) => resolve(question, identified))
    .filter((question) => question !== null)
  const data = cvDataSchema.parse(dropEmptyItems(identified))
  const kept = itemIdsOf(data)
  return {
    data,
    questions: resolved.filter(
      (question) => question.target.itemId === undefined || kept.has(question.target.itemId),
    ),
  }
}

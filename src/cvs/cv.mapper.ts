import {
  type Cv,
  type CvData,
  type CvStatusInfo,
  type CvSummary,
  type Question,
  computeMatch,
  cvDataSchema,
  storedAnswer,
} from '@cv/shared'
import { AppError } from '../common/errors/app-error'
import type { cvQuestions, cvs } from '../database/schema'

export type CvRow = typeof cvs.$inferSelect
export type QuestionRow = typeof cvQuestions.$inferSelect

/**
 * The stored draft, checked against the schema before anyone sees it: a row that doesn't match
 * is `500 DATA_CORRUPT` (logged by the error filter), never a broken editor or PDF.
 */
export const draftOf = (row: CvRow): CvData | null => {
  if (row.data === null) return null
  const parsed = cvDataSchema.safeParse(row.data)
  if (!parsed.success) {
    throw new AppError(500, 'DATA_CORRUPT', 'This CV could not be read. Please contact support.', {
      cvId: row.id,
    })
  }
  return parsed.data
}

export const toQuestion = (row: QuestionRow): Question => ({
  id: row.id,
  kind: row.kind,
  origin: row.origin,
  text: row.text,
  label: row.label,
  options: row.options ?? [],
  claim: row.claim,
  target: row.target,
  status: row.status,
  answer: row.answer === null ? null : storedAnswer(row.answer),
})

/** Open questions first, then in the order they were asked. */
const byOpenThenPosition = (a: QuestionRow, b: QuestionRow): number =>
  Number(b.status === 'open') - Number(a.status === 'open') || a.position - b.position

/** The polled part. `queuePosition` is passed in, and kept only while the CV is queued. */
export const toStatusInfo = (row: CvRow, queuePosition: number | null): CvStatusInfo => ({
  id: row.id,
  status: row.status,
  stage: row.stage,
  attempt: row.attempt,
  maxAttempts: row.maxAttempts,
  queuePosition: row.status === 'queued' ? queuePosition : null,
  errorCode: row.errorCode,
  error: row.error,
  updatedAt: row.updatedAt.toISOString(),
})

/** The whole CV for its owner. The source text and the facts never leave the server. */
export const toCv = (row: CvRow, questions: QuestionRow[], queuePosition: number | null): Cv => ({
  ...toStatusInfo(row, queuePosition),
  title: row.title,
  targetRole: row.targetRole,
  roleContext: row.roleContext,
  language: row.language,
  sourceType: row.sourceType,
  sourceFilename: row.sourceFilename,
  data: draftOf(row),
  version: row.version,
  requirements: row.requirements,
  suggestedRoles: row.suggestedRoles,
  verification: row.verification,
  questions: [...questions].sort(byOpenThenPosition).map(toQuestion),
  createdAt: row.createdAt.toISOString(),
})

/**
 * A list item; the match is computed from the draft with the same rule as the editor's. A corrupt
 * draft only loses its match here, so one bad row doesn't take the whole list down; opening that
 * CV answers `500 DATA_CORRUPT` and logs it.
 */
export const toSummary = (row: CvRow, openQuestions: number): CvSummary => {
  const parsed = row.data === null ? null : cvDataSchema.safeParse(row.data)
  const match = parsed?.success ? computeMatch(parsed.data, row.requirements) : null
  return {
    id: row.id,
    title: row.title,
    targetRole: row.targetRole,
    language: row.language,
    status: row.status,
    openQuestions,
    match: match === null ? null : { covered: match.covered, total: match.total },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

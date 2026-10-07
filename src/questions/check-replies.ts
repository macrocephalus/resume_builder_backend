import {
  type Answer,
  type CvData,
  type Question,
  type Reply,
  SKIPPABLE_KINDS,
  answerSchemaFor,
  targetExists,
} from '@cv/shared'
import { ZodError, type core } from 'zod'
import { AppError } from '../common/errors/app-error'
import { validationError } from '../common/errors/validation-error'

/** A reply that passed every check: its question and its parsed answer, or `null` for a skip. */
export type CheckedReply = { question: Question; answer: Answer | null }

const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message)

/**
 * Every reply of a batch checked against its question and the draft before anything is written
 * (docs/api.md "Questions"), in the order sent. A missing question is `404`, one that can't take
 * the reply now is `409`, both at the first one found; replies that don't fit their question
 * (an answer outside its options, a skipped `confirm`) are gathered into one `400` keyed
 * `replies.<index>.answer…`, so the UI can name each card.
 */
export const checkReplies = (
  replies: readonly Reply[],
  questions: ReadonlyMap<string, Question>,
  data: CvData,
): CheckedReply[] => {
  const checked: CheckedReply[] = []
  const issues: core.$ZodIssue[] = []
  replies.forEach((reply, index) => {
    const question = questions.get(reply.questionId)
    if (!question) throw new AppError(404, 'NOT_FOUND', 'This question does not exist.')
    if (question.status !== 'open') throw invalidState('This question has already been closed.')
    if (!targetExists(data, question)) {
      throw invalidState('The part of the CV this question is about has been removed.')
    }
    const at = ['replies', index, 'answer']
    if (reply.answer === null) {
      if (SKIPPABLE_KINDS.some((kind) => kind === question.kind)) {
        checked.push({ question, answer: null })
      } else {
        issues.push({
          code: 'custom',
          message: 'A confirm question must be answered yes or no.',
          path: at,
          input: null,
        })
      }
      return
    }
    if (reply.answer.kind !== question.kind) {
      throw invalidState(`This question takes a "${question.kind}" answer.`)
    }
    const parsed = answerSchemaFor(question).safeParse(reply.answer)
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map((issue) => ({ ...issue, path: [...at, ...issue.path] })),
      )
      return
    }
    checked.push({ question, answer: parsed.data })
  })
  if (issues.length > 0) throw validationError(new ZodError(issues))
  return checked
}

import { type CvData, applyAnswer } from '@cv/shared'
import type { Fact } from '../database/schema'
import type { CheckedReply } from './check-replies'
import { factOf } from './fact-of'
import type { WordedBullets } from './wording-request'

/**
 * The draft and the facts after a checked batch, in the order sent: a worded answer adds its
 * bullets (none for "nothing to add"), any other answer is written as given (the shared
 * `applyAnswer`); every answer is kept as a fact as the user wrote it; a skip changes neither.
 */
export const applyReplies = (
  data: CvData,
  facts: readonly Fact[],
  replies: readonly CheckedReply[],
  worded: WordedBullets,
  newId: () => string,
): { data: CvData; facts: Fact[] } => {
  let next = data
  const kept = [...facts]
  for (const { question, answer } of replies) {
    if (answer === null) continue
    const bullets = worded.get(question.id)
    next =
      bullets === undefined
        ? applyAnswer(next, question, answer, newId)
        : bullets.reduce(
            (draft, bullet) => applyAnswer(draft, question, { kind: 'text', value: bullet }, newId),
            next,
          )
    kept.push(factOf(question, answer))
  }
  return { data: next, facts: kept }
}

import { type CvData, applyAnswer } from '@cv/shared'
import type { Fact } from '../database/schema'
import type { CheckedReply } from './check-replies'
import { factOf } from './fact-of'

/**
 * The draft and the facts after a checked batch: each answer written into the draft as written
 * (the shared `applyAnswer`) and kept as a fact, in the order sent; a skip changes neither.
 */
export const applyReplies = (
  data: CvData,
  facts: readonly Fact[],
  replies: readonly CheckedReply[],
  newId: () => string,
): { data: CvData; facts: Fact[] } => {
  let next = data
  const kept = [...facts]
  for (const { question, answer } of replies) {
    if (answer === null) continue
    next = applyAnswer(next, question, answer, newId)
    kept.push(factOf(question, answer))
  }
  return { data: next, facts: kept }
}

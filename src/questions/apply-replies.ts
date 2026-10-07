import { CV_LIMITS, type CvData, type Question, applyAnswer } from '@cv/shared'
import type { Fact } from '../database/schema'
import type { CheckedReply } from './check-replies'
import { factOf } from './fact-of'
import type { Worded, WordedAnswers } from './wording-request'

/** The draft with a worded answer written to its question's target; nothing for "nothing to add". */
const withWorded = (
  data: CvData,
  question: Question,
  worded: Worded,
  newId: () => string,
): CvData => {
  const text = (value: string) => ({ kind: 'text', value }) as const
  switch (worded.kind) {
    case 'bullets':
      return worded.bullets.reduce(
        (draft, bullet) => applyAnswer(draft, question, text(bullet), newId),
        data,
      )
    case 'summary':
      return worded.sentence === null
        ? data
        : applyAnswer(data, question, text(worded.sentence), newId)
    case 'job':
      // a fresh job after the others, within the cap, as applyAnswer adds the as-written one
      return worded.job === null || data.experience.length >= CV_LIMITS.experience
        ? data
        : {
            ...data,
            experience: [
              ...data.experience,
              { id: newId(), ...worded.job, bullets: [...worded.job.bullets] },
            ],
          }
  }
}

/**
 * The draft and the facts after a checked batch, in the order sent: a worded answer goes in as
 * the model wrote it (`withWorded`), any other answer as given (the shared `applyAnswer`); every
 * answer is kept as a fact as the user wrote it; a skip changes neither.
 */
export const applyReplies = (
  data: CvData,
  facts: readonly Fact[],
  replies: readonly CheckedReply[],
  worded: WordedAnswers,
  newId: () => string,
): { data: CvData; facts: Fact[] } => {
  let next = data
  const kept = [...facts]
  for (const { question, answer } of replies) {
    if (answer === null) continue
    const result = worded.get(question.id)
    next =
      result === undefined
        ? applyAnswer(next, question, answer, newId)
        : withWorded(next, question, result, newId)
    kept.push(factOf(question, answer))
  }
  return { data: next, facts: kept }
}

import { type Answer, type Question, storedAnswer } from '@cv/shared'
import type { Fact } from '../database/schema'

/** The text of the answer the way it went into the CV; "No" for a denied claim. */
const answerText = (question: Question, answer: Answer): string => {
  if (answer.kind === 'confirm') return answer.value ? (question.claim ?? 'Yes') : 'No'
  const stored = storedAnswer(answer)
  const text = Array.isArray(stored) ? stored.join(', ') : String(stored)
  return answer.kind === 'choice' && question.target.section === 'skills'
    ? `${question.label}: ${text}`
    : text
}

/**
 * An answer kept as a fact for every later generation (root architecture §6.5). The verifier reads
 * only the answers of facts (backend architecture §4), so a fact's answer holds exactly what the
 * user stood behind: a confirmed claim itself, a denied one only "No". A confirm question's text
 * doesn't name its claim, so the fact's question quotes it.
 */
export const factOf = (question: Question, answer: Answer): Fact => ({
  question: question.claim === null ? question.text : `${question.text} "${question.claim}"`,
  answer: answerText(question, answer),
})

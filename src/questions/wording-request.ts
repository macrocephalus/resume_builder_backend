import type { Answer, CvData } from '@cv/shared'
import type { AnswerToWord, WordedAnswer } from '../agents/answer/answer-wording.schema'
import { unbackedInWording } from '../agents/verify/verify-wording'
import type { CheckedReply } from './check-replies'

/** Bullets to write instead of the raw answer, by question id; `[]` adds nothing. */
export type WordedBullets = ReadonlyMap<string, readonly string[]>

/** Why a worded answer is not used; `unbacked` names what it added (user content). */
export type WordingRefusal =
  | { questionId: string; reason: 'missing' }
  | { questionId: string; reason: 'unbacked'; unbacked: string[] }

/** The free text of an answer: a `text` value or the "Other" of a `choice`. */
const freeText = (answer: Answer): string | null => {
  if (answer.kind === 'text') return answer.value
  if (answer.kind === 'choice' && answer.other !== undefined) return answer.other
  return null
}

/** The job or project a bullets answer adds to, as the model sees it. */
const itemOf = (data: CvData, section: string, itemId: string): AnswerToWord['item'] | null => {
  if (section === 'experience') {
    const job = data.experience.find((item) => item.id === itemId)
    return job ? { title: job.title, company: job.company, bullets: job.bullets } : null
  }
  if (section === 'projects') {
    const project = data.projects.find((item) => item.id === itemId)
    return project ? { title: project.name, company: null, bullets: project.bullets } : null
  }
  return null
}

/**
 * The answers of a checked batch that answer wording turns into bullets (root
 * `docs/architecture.md` §6.5): free text about the bullets of an experience or project item,
 * each with its question's id and the item as context.
 */
export const answersToWord = (data: CvData, replies: readonly CheckedReply[]): AnswerToWord[] =>
  replies.flatMap(({ question, answer }) => {
    const { section, itemId, field } = question.target
    const text = answer === null ? null : freeText(answer)
    if (text === null || field !== 'bullets' || itemId === undefined) return []
    const item = itemOf(data, section, itemId)
    return item === null ? [] : [{ id: question.id, question: question.text, answer: text, item }]
  })

/**
 * The worded bullets to write, by question id, and why the others are not used: an answer the
 * model left out, or whose bullets state a number or a technology the answer and the source
 * don't (`unbackedInWording`). Those go in as written.
 */
export const acceptWording = (
  toWord: readonly AnswerToWord[],
  worded: readonly WordedAnswer[],
  source: string,
): { accepted: WordedBullets; refused: WordingRefusal[] } => {
  const byId = new Map(worded.map((answer) => [answer.id, answer.bullets]))
  const accepted = new Map<string, readonly string[]>()
  const refused: WordingRefusal[] = []
  for (const { id, answer } of toWord) {
    const bullets = byId.get(id)
    if (bullets === undefined) {
      refused.push({ questionId: id, reason: 'missing' })
      continue
    }
    const unbacked = bullets.flatMap((bullet) => unbackedInWording(bullet, answer, source))
    if (unbacked.length > 0) {
      refused.push({ questionId: id, reason: 'unbacked', unbacked })
      continue
    }
    accepted.set(id, bullets)
  }
  return { accepted, refused }
}

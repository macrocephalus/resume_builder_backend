import type { Answer, CvData, QuestionTarget } from '@cv/shared'
import {
  ANSWER_WORDING_LIMITS,
  type AnswerToWord,
  type WordedAnswer,
  type WordingTarget,
} from '../agents/answer/answer-wording.schema'
import { containsWord, normalise } from '../agents/verify/normalise'
import { unbackedInWording } from '../agents/verify/verify-wording'
import type { CheckedReply } from './check-replies'

/** A job the model wrote from an answer about a job the draft is missing. */
export type WordedJob = Pick<WordedAnswer, 'title' | 'company' | 'period' | 'bullets'>

/** What an answer becomes instead of its raw text; `null` / `[]` adds nothing. */
export type Worded =
  | { kind: 'bullets'; bullets: readonly string[] }
  | { kind: 'summary'; sentence: string | null }
  | { kind: 'job'; job: WordedJob | null }

/** The worded answers to write, by question id. */
export type WordedAnswers = ReadonlyMap<string, Worded>

/**
 * Why a worded answer is not used: left out of the output, outside its kind's shape (too many
 * bullets, a sentence too long, a job without bullets), or stating what the answer doesn't;
 * `unbacked` names what (user content).
 */
export type WordingRefusal =
  | { questionId: string; reason: 'missing' | 'shape' }
  | { questionId: string; reason: 'unbacked'; unbacked: string[] }

/** The free text of an answer: a `text` value or the "Other" of a `choice`. */
const freeText = (answer: Answer): string | null => {
  if (answer.kind === 'text') return answer.value
  if (answer.kind === 'choice' && answer.other !== undefined) return answer.other
  return null
}

/**
 * What kind of wording a target takes and what the model sees of it; `null`: not worded. The
 * summary and the whole experience block are recognised as `applyAnswer` recognises them.
 */
const targetOf = (
  data: CvData,
  { section, itemId, field }: QuestionTarget,
): WordingTarget | null => {
  const whole = itemId === undefined && field === undefined
  if (section === 'summary' && whole) return { kind: 'summary', summary: data.summary }
  if (section === 'experience' && whole) return { kind: 'job' }
  if (field !== 'bullets' || itemId === undefined) return null
  if (section === 'experience') {
    const job = data.experience.find((item) => item.id === itemId)
    if (!job) return null
    return {
      kind: 'bullets',
      item: { title: job.title, company: job.company, bullets: job.bullets },
    }
  }
  if (section === 'projects') {
    const project = data.projects.find((item) => item.id === itemId)
    if (!project) return null
    return {
      kind: 'bullets',
      item: { title: project.name, company: null, bullets: project.bullets },
    }
  }
  return null
}

/**
 * The answers of a checked batch that answer wording rewrites (root `docs/architecture.md`
 * §6.5): free text about the bullets of an experience or project item, the summary, or a job the
 * draft is missing; each with its question's id and what it adds to.
 */
export const answersToWord = (data: CvData, replies: readonly CheckedReply[]): AnswerToWord[] =>
  replies.flatMap(({ question, answer }) => {
    const text = answer === null ? null : freeText(answer)
    const target = text === null ? null : targetOf(data, question.target)
    if (text === null || target === null) return []
    return [{ id: question.id, question: question.text, answer: text, ...target }]
  })

type Verdict =
  | { kind: 'accepted'; worded: Worded }
  | { kind: 'refused'; reason: 'shape' }
  | { kind: 'refused'; reason: 'unbacked'; unbacked: string[] }

/** A title or a company of a new job, unless the answer states it as it is. */
const unlessStated = (value: string | null, answer: string): string[] =>
  value === null || containsWord(normalise(answer), normalise(value)) ? [] : [normalise(value)]

/** The model's result for one answer, judged by its kind's shape and by what the answer states. */
const verdictOf = (toWord: AnswerToWord, result: WordedAnswer, source: string): Verdict => {
  const unbackedIn = (texts: ReadonlyArray<string | null>) =>
    texts.flatMap((text) => (text === null ? [] : unbackedInWording(text, toWord.answer, source)))
  const judged = (worded: Worded, unbacked: string[]): Verdict =>
    unbacked.length > 0
      ? { kind: 'refused', reason: 'unbacked', unbacked: [...new Set(unbacked)] }
      : { kind: 'accepted', worded }
  const shape: Verdict = { kind: 'refused', reason: 'shape' }
  switch (toWord.kind) {
    case 'bullets':
      if (result.bullets.length > ANSWER_WORDING_LIMITS.bullets) return shape
      return judged({ kind: 'bullets', bullets: result.bullets }, unbackedIn(result.bullets))
    case 'summary':
      if ((result.sentence?.length ?? 0) > ANSWER_WORDING_LIMITS.sentence) return shape
      return judged({ kind: 'summary', sentence: result.sentence }, unbackedIn([result.sentence]))
    case 'job': {
      const { title, company, period, bullets } = result
      const fields = [title, company, period]
      if (bullets.length === 0 && fields.every((field) => field === null)) {
        return { kind: 'accepted', worded: { kind: 'job', job: null } }
      }
      if (bullets.length === 0 || bullets.length > ANSWER_WORDING_LIMITS.jobBullets) return shape
      return judged({ kind: 'job', job: { title, company, period, bullets } }, [
        ...unbackedIn([...bullets, ...fields]),
        ...unlessStated(title, toWord.answer),
        ...unlessStated(company, toWord.answer),
      ])
    }
  }
}

/**
 * The worded answers to write, by question id, and why the others are not used: an answer the
 * model left out, one outside its kind's shape, or text that states a number, a technology, a
 * title or a company the answer (and, for a technology, the source) doesn't. Those go in as
 * written.
 */
export const acceptWording = (
  toWord: readonly AnswerToWord[],
  results: readonly WordedAnswer[],
  source: string,
): { accepted: WordedAnswers; refused: WordingRefusal[] } => {
  const byId = new Map(results.map((result) => [result.id, result]))
  const accepted = new Map<string, Worded>()
  const refused: WordingRefusal[] = []
  for (const answer of toWord) {
    const result = byId.get(answer.id)
    const verdict: Verdict | null = result ? verdictOf(answer, result, source) : null
    if (verdict === null) refused.push({ questionId: answer.id, reason: 'missing' })
    else if (verdict.kind === 'accepted') accepted.set(answer.id, verdict.worded)
    else if (verdict.reason === 'unbacked') {
      refused.push({ questionId: answer.id, reason: 'unbacked', unbacked: verdict.unbacked })
    } else refused.push({ questionId: answer.id, reason: 'shape' })
  }
  return { accepted, refused }
}

import { CV_LIMITS, type CvLanguage } from '@cv/shared'
import { z } from 'zod'

/** The bounds of one wording call (root `docs/architecture.md` §6.5, "Answer wording"). */
export const ANSWER_WORDING_LIMITS = {
  /** Bullets an answer about an existing job may become. */
  bullets: 3,
  /** Bullets of a new job. */
  jobBullets: 6,
  /** Characters of the sentence added to the summary. */
  sentence: 300,
  /** The whole call, retries included; past it the answers go in as written. */
  timeoutMs: 15_000,
  maxRetries: 1,
  maxOutputTokens: 4_000,
} as const

/** The item a bullets answer adds to, for context: never rewritten. */
export type WordingItem = {
  title: string | null
  company: string | null
  bullets: readonly string[]
}

/**
 * One answer to word; `id` (its question's) is how the model's result is matched back to it.
 * `bullets`: new bullets of an existing item; `summary`: one sentence added to the summary;
 * `job`: a job the draft is missing.
 */
export type AnswerToWord = { id: string; question: string; answer: string } & WordingTarget

/** What an answer is worded for, with what the model sees of it. */
export type WordingTarget =
  | { kind: 'bullets'; item: WordingItem }
  | { kind: 'summary'; summary: string | null }
  | { kind: 'job' }

/** Everything one wording call is about. */
export type WordingRequest = {
  language: CvLanguage
  targetRole: string
  answers: readonly AnswerToWord[]
}

const text = (max: number) => z.string().trim().min(1).max(max)

/**
 * What the model returns per answer id. Every field is always there, `null` or `[]` where its
 * kind has none or the answer gives nothing for the CV; the code reads only its kind's fields.
 * The bounds are the CV's; the tighter ones of each kind are checked per answer, so an answer
 * over them falls back alone instead of failing the whole output.
 */
export const wordedAnswersSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      bullets: z.array(text(CV_LIMITS.bullet)).max(CV_LIMITS.bullets),
      sentence: text(CV_LIMITS.summary).nullable(),
      title: text(CV_LIMITS.shortText).nullable(),
      company: text(CV_LIMITS.shortText).nullable(),
      period: text(CV_LIMITS.shortText).nullable(),
    }),
  ),
})
export type WordedAnswer = z.infer<typeof wordedAnswersSchema>['answers'][number]

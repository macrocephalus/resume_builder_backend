import { CV_LIMITS, type CvLanguage } from '@cv/shared'
import { z } from 'zod'

/** The bounds of one wording call (root `docs/architecture.md` §6.5, "Answer wording"). */
export const ANSWER_WORDING_LIMITS = {
  /** Bullets one answer may become. */
  bullets: 3,
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

/** One answer to word; `id` (its question's) is how the model's result is matched back to it. */
export type AnswerToWord = { id: string; question: string; answer: string; item: WordingItem }

/** Everything one wording call is about. */
export type WordingRequest = {
  language: CvLanguage
  targetRole: string
  answers: readonly AnswerToWord[]
}

/** What the model returns: per answer id, its bullets; none when it gives nothing for the CV. */
export const wordedAnswersSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      bullets: z
        .array(z.string().trim().min(1).max(CV_LIMITS.bullet))
        .max(ANSWER_WORDING_LIMITS.bullets),
    }),
  ),
})
export type WordedAnswer = z.infer<typeof wordedAnswersSchema>['answers'][number]

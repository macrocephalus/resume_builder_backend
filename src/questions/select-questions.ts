import { QUESTIONS } from '../config/limits'
import { type NewQuestion, targetKey } from './new-question'

export type QuestionSources = {
  /** From `findMissing` over the final draft. */
  auto: readonly NewQuestion[]
  /** The verifier's yes/no claims. */
  confirm: readonly NewQuestion[]
  /** The verifier's questions about cleared fields. */
  cleared: readonly NewQuestion[]
  /** The verifier's tick-what-applies skills question. */
  multi: NewQuestion | null
  /** The model's, in its order. */
  model: readonly NewQuestion[]
}

/**
 * The questions a draft is saved with (backend architecture §3): auto, `confirm` (at most 5),
 * the cleared fields, the `multi`, then the model's (at most 7, in its order), and at most 12 in
 * all, so the last ones are the first to go. A model question about the same target as an auto or
 * cleared-field question takes that one's place; a claim to confirm is never replaced. A model
 * question about the `multi`'s target (the whole skills block) is dropped: the `multi` asks it
 * with options, so the user isn't asked about skills twice.
 */
export const selectQuestions = ({
  auto,
  confirm,
  cleared,
  multi,
  model,
}: QuestionSources): NewQuestion[] => {
  const multiKey = multi === null ? null : targetKey(multi.target)
  // one model question per target, the first the model wrote
  const modelByTarget = new Map<string, NewQuestion>()
  const kept = model.filter((question) => targetKey(question.target) !== multiKey)
  for (const question of kept.slice(0, QUESTIONS.model)) {
    const key = targetKey(question.target)
    if (!modelByTarget.has(key)) modelByTarget.set(key, question)
  }
  const replacing = new Set<NewQuestion>()
  const replaced = (question: NewQuestion): NewQuestion => {
    const replacement = modelByTarget.get(targetKey(question.target))
    if (replacement === undefined || replacing.has(replacement)) return question
    replacing.add(replacement)
    return replacement
  }
  const first = auto.map(replaced)
  const verifier = [
    ...confirm.slice(0, QUESTIONS.confirm),
    ...cleared.map(replaced),
    ...(multi === null ? [] : [multi]),
  ]
  const rest = [...modelByTarget.values()].filter((question) => !replacing.has(question))
  return [...first, ...verifier, ...rest].slice(0, QUESTIONS.open)
}

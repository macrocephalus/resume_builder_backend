import { type NewQuestion, targetKey } from './new-question'

/**
 * The questions a draft is saved with, in order: auto, then the model's in its order. A model
 * question about the same target as an auto one takes the auto one's place. (Ticket 06 adds the
 * verifier's questions and the caps.)
 */
export const selectQuestions = ({
  auto,
  model,
}: {
  auto: readonly NewQuestion[]
  model: readonly NewQuestion[]
}): NewQuestion[] => {
  const modelByTarget = new Map(model.map((question) => [targetKey(question.target), question]))
  const replacing = new Set<NewQuestion>()
  const first = auto.map((question) => {
    const replacement = modelByTarget.get(targetKey(question.target))
    if (replacement === undefined) return question
    replacing.add(replacement)
    return replacement
  })
  return [...first, ...model.filter((question) => !replacing.has(question))]
}

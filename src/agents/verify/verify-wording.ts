import { containsWord, normalise, numbersIn } from './normalise'
import { skillLikeWords } from './skill-like'

/**
 * What a worded answer states that it may not (root `docs/architecture.md` §6.5, "Answer
 * wording"): every number not in the answer it was worded from, every technology-like word in
 * neither the answer nor the source, normalised, in the order they appear. Empty when the text
 * can go into the CV.
 */
export const unbackedInWording = (text: string, answer: string, source: string): string[] => {
  const answerNumbers = new Set(numbersIn(normalise(answer)))
  const corpus = normalise(`${answer}\n${source}`)
  const numbers = numbersIn(normalise(text)).filter((number) => !answerNumbers.has(number))
  const words = skillLikeWords(text)
    .map(normalise)
    .filter((word) => !containsWord(corpus, word))
  return [...new Set([...numbers, ...words])]
}

import { getCvLanguage } from '@cv/shared'
import type { AnswerToWord, WordingRequest } from '../answer/answer-wording.schema'
import { escapeTagContent } from './escape-tags'
import { ANSWER_WORDING_SYSTEM } from './system/answer-wording.system'

const tag = (name: string, content: string): string =>
  `<${name}>${escapeTagContent(content)}</${name}>`

const jobOf = ({ item }: AnswerToWord): string =>
  [
    `Title: ${item.title ?? '(none)'}`,
    `Company: ${item.company ?? '(none)'}`,
    ...item.bullets.map((bullet) => `- ${bullet}`),
  ].join('\n')

const answerOf = (answer: AnswerToWord): string =>
  [
    `<answer id="${escapeTagContent(answer.id)}">`,
    tag('question', answer.question),
    tag('reply', answer.answer),
    tag('job', jobOf(answer)),
    '</answer>',
  ].join('\n')

/** `{ instructions, message }` for one wording call: the static rules, then the escaped data. */
export const buildWordingPrompt = (
  request: WordingRequest,
): { instructions: string; message: string } => ({
  instructions: ANSWER_WORDING_SYSTEM,
  message: [
    tag('cv_language', getCvLanguage(request.language).englishName),
    tag('target_role', request.targetRole),
    ...request.answers.map(answerOf),
  ].join('\n'),
})

import { getCvLanguage } from '@cv/shared'
import type { AnswerToWord, WordingRequest } from '../answer/answer-wording.schema'
import { escapeTagContent } from './escape-tags'
import { ANSWER_WORDING_SYSTEM } from './system/answer-wording.system'

const tag = (name: string, content: string): string =>
  `<${name}>${escapeTagContent(content)}</${name}>`

/** What an answer of its kind is added to, as the model sees it; nothing for a new job. */
const contextOf = (answer: AnswerToWord): string[] => {
  switch (answer.kind) {
    case 'bullets':
      return [
        tag(
          'job',
          [
            `Title: ${answer.item.title ?? '(none)'}`,
            `Company: ${answer.item.company ?? '(none)'}`,
            ...answer.item.bullets.map((bullet) => `- ${bullet}`),
          ].join('\n'),
        ),
      ]
    case 'summary':
      return [tag('summary', answer.summary ?? '(none)')]
    case 'job':
      return []
  }
}

const answerOf = (answer: AnswerToWord): string =>
  [
    `<answer id="${escapeTagContent(answer.id)}" kind="${answer.kind}">`,
    tag('question', answer.question),
    tag('reply', answer.answer),
    ...contextOf(answer),
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

import { type CvData, type CvLanguage, autoQuestionText, findMissing } from '@cv/shared'
import { type NewQuestion, questionTarget } from './new-question'

/**
 * A `text` question for every required part the draft lacks (`findMissing`), worded in the CV
 * language by the shared `autoQuestionText`: the server never words one its own way.
 */
export const buildAutoQuestions = (data: CvData, language: CvLanguage): NewQuestion[] =>
  findMissing(data).map((part) => {
    const { text, label } = autoQuestionText(data, part, language)
    return {
      kind: 'text',
      origin: 'auto',
      text,
      label,
      options: [],
      claim: null,
      target: questionTarget(part.section, part.itemId, part.field),
    }
  })

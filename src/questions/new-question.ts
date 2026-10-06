import type { CvSection, Question, QuestionTarget } from '@cv/shared'

/** A question about to be stored: open, unanswered, its position given when saved. */
export type NewQuestion = Pick<
  Question,
  'kind' | 'origin' | 'text' | 'label' | 'options' | 'claim' | 'target'
>

/** A target with only the parts that are set (the stored JSON has no `undefined` keys). */
export const questionTarget = (
  section: CvSection,
  itemId: string | undefined,
  field: string | undefined,
): QuestionTarget => ({
  section,
  ...(itemId === undefined ? {} : { itemId }),
  ...(field === undefined ? {} : { field }),
})

/** One key per target, so two questions about the same field can be told apart from others. */
export const targetKey = ({ section, itemId, field }: NewQuestion['target']): string =>
  [section, itemId ?? '', field ?? ''].join('|')

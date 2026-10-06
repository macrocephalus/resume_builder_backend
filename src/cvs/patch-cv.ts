import { type CvData, type Question, dropEmptyItems, targetExists } from '@cv/shared'

export type PatchedCv = {
  /** The draft as it is stored: empty items and blank bullets, skills and links dropped. */
  data: CvData
  /** The open questions about an item no longer in the draft: they become `skipped`. */
  toSkip: string[]
}

/**
 * A manual edit of the draft (docs/api.md, `PATCH /api/cvs/:id`). Only removing an item closes a
 * question: filling a field by hand leaves the question about it open.
 */
export const patchCv = (
  data: CvData,
  openQuestions: ReadonlyArray<Pick<Question, 'id' | 'target'>>,
): PatchedCv => {
  const stored = dropEmptyItems(data)
  return {
    data: stored,
    toSkip: openQuestions.filter((question) => !targetExists(stored, question)).map(({ id }) => id),
  }
}

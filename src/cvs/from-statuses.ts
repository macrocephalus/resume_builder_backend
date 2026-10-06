import { CV_STATUSES, type CvStatus, canTransition } from '@cv/shared'

/**
 * The statuses a CV may move to `to` from, by the shared status machine (docs/cv-statuses.md).
 * `CvStatusService` updates only rows in one of these: the compare-and-set of every status write.
 */
export const fromStatuses = (to: CvStatus): CvStatus[] =>
  CV_STATUSES.filter((from) => canTransition(from, to))

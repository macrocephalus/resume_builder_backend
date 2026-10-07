import { ANSWER_WORDING_BUDGET } from '../config/limits'

/** Injection token for the budget of worded answers (`WordingBudget`). */
export const WORDING_BUDGET = Symbol('WORDING_BUDGET')

/** Answers a user may have worded: `perHour` in any sliding `windowMs`. Tests bind a smaller one. */
export type WordingBudget = { perHour: number; windowMs: number }

export const WORDING_BUDGET_DEFAULTS: WordingBudget = {
  perHour: ANSWER_WORDING_BUDGET.perHour,
  windowMs: ANSWER_WORDING_BUDGET.windowMs,
}

/** How many of the `wanted` answers may be worded when the window already holds `used`. */
export const grantedWordings = (
  { used, wanted }: { used: number; wanted: number },
  { perHour }: Pick<WordingBudget, 'perHour'>,
): number => Math.min(wanted, Math.max(0, perHour - used))

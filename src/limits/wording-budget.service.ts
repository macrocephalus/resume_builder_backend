import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import { DATABASE, type Database } from '../database/database.module'
import { answerWordings } from '../database/schema'
import { createdWithin, lockUser } from './user-window'
import { WORDING_BUDGET, type WordingBudget, grantedWordings } from './wording-budget'

/** The budget of worded answers (root `docs/architecture.md` §6.5): a cost guard, not a limit. */
@Injectable()
export class WordingBudgetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORDING_BUDGET) private readonly budget: WordingBudget,
  ) {}

  /**
   * Takes up to `wanted` answers from what the user may have worded in the sliding window and
   * returns how many it took. Under the user's row lock (the one a generation start takes), so
   * two batches at once, from any api instance, count one after the other.
   */
  async take(userId: string, wanted: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId)
      const [row] = await tx
        .select({ used: sql`coalesce(sum(${answerWordings.answers}), 0)`.mapWith(Number) })
        .from(answerWordings)
        .where(
          and(
            eq(answerWordings.userId, userId),
            createdWithin(answerWordings.createdAt, this.budget.windowMs),
          ),
        )
      if (!row) throw new Error('sum() returned no row')
      const granted = grantedWordings({ used: row.used, wanted }, this.budget)
      if (granted > 0) await tx.insert(answerWordings).values({ userId, answers: granted })
      return granted
    })
  }
}

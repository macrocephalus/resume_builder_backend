import { CV_STATUSES, isInProgress } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, count, eq, inArray } from 'drizzle-orm'
import { AppError } from '../common/errors/app-error'
import { GENERATION } from '../config/limits'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvs } from '../database/schema'

const IN_PROGRESS = CV_STATUSES.filter(isInProgress)

/** The limits on starting a generation (backend architecture §6). */
@Injectable()
export class LimitsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * `429 TOO_MANY_ACTIVE` when the user already has the maximum of CVs in progress. Runs in the
   * transaction that then starts one; two requests at the same moment can both pass (accepted).
   */
  async assertCanStart(userId: string, executor: Executor = this.db): Promise<void> {
    const [row] = await executor
      .select({ active: count() })
      .from(cvs)
      .where(and(eq(cvs.userId, userId), inArray(cvs.status, IN_PROGRESS)))
    const limit = GENERATION.activePerUser
    if ((row?.active ?? 0) >= limit) {
      throw new AppError(
        429,
        'TOO_MANY_ACTIVE',
        `${limit} CVs are already being generated. Wait for one to finish.`,
        { limit },
      )
    }
  }
}

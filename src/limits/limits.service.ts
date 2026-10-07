import { CV_STATUSES, type Usage, isInProgress } from '@cv/shared'
import { Inject, Injectable } from '@nestjs/common'
import { and, count, eq, inArray, min, sql } from 'drizzle-orm'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../common/errors/app-error'
import { DATABASE, type Database, type Executor } from '../database/database.module'
import { cvs, generationJobs } from '../database/schema'
import { GENERATION_LIMITS, type GenerationLimits } from './generation-limits'
import { type HourlyWindow, hourlyWindow } from './hourly-window'
import { createdWithin, lockUser } from './user-window'

const IN_PROGRESS = CV_STATUSES.filter(isInProgress)

/** The limits on starting a generation (backend architecture §6). */
@Injectable()
export class LimitsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(GENERATION_LIMITS) private readonly allowed: GenerationLimits,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LimitsService.name)
  }

  /** `GET /api/usage`: what the user has used of both limits. */
  async usage(userId: string): Promise<Usage> {
    const [hourly, active] = await Promise.all([this.hourly(userId), this.active(userId)])
    return {
      generations: {
        used: hourly.used,
        limit: hourly.limit,
        resetsAt: hourly.resetsAt.toISOString(),
      },
      active: { used: active, limit: this.allowed.activePerUser },
    }
  }

  /**
   * `429 RATE_LIMITED` (with `Retry-After`) when the user started the hourly maximum, else
   * `429 TOO_MANY_ACTIVE` when they have the maximum of CVs in progress. Runs in the transaction
   * that then starts one, and locks the user's row until it ends: two starts of one user at the
   * same moment count one after the other, so the second sees the first.
   */
  async assertCanStart(userId: string, tx: Executor): Promise<void> {
    await lockUser(tx, userId)
    const hourly = await this.hourly(userId, tx)
    const active = hourly.full ? null : await this.active(userId, tx)
    this.logger.debug(
      // the user id is on the line already: the auth guard assigns it to the request
      { hourly: { used: hourly.used, limit: hourly.limit }, active },
      'generation limits checked',
    )
    if (hourly.full) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        `You have started ${hourly.limit} generations within the limit's window. Try again later.`,
        { limit: hourly.limit },
        { 'Retry-After': String(hourly.retryAfterSeconds) },
      )
    }
    const limit = this.allowed.activePerUser
    if (active !== null && active >= limit) {
      throw new AppError(
        429,
        'TOO_MANY_ACTIVE',
        `${limit} CVs are already being generated. Wait for one to finish.`,
        { limit },
      )
    }
  }

  /**
   * The user's generation jobs of the sliding window, counted on the database's clock, which
   * stamped them.
   */
  private async hourly(userId: string, executor: Executor = this.db): Promise<HourlyWindow> {
    const [row] = await executor
      .select({
        used: count(),
        oldest: min(generationJobs.createdAt),
        now: sql`now()`.mapWith(generationJobs.createdAt),
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.userId, userId),
          createdWithin(generationJobs.createdAt, this.allowed.windowMs),
        ),
      )
    if (!row) throw new Error('count() returned no row')
    return hourlyWindow(row, this.allowed)
  }

  private async active(userId: string, executor: Executor = this.db): Promise<number> {
    const [row] = await executor
      .select({ active: count() })
      .from(cvs)
      .where(and(eq(cvs.userId, userId), inArray(cvs.status, IN_PROGRESS)))
    if (!row) throw new Error('count() returned no row')
    return row.active
  }
}

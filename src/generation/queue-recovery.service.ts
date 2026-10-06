import type { CvStatus } from '@cv/shared'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { safeError } from '../common/logging/safe-error'
import { CvStatusService } from '../cvs/cv-status.service'
import { CvsService } from '../cvs/cvs.service'
import { DATABASE, type Database } from '../database/database.module'
import { closeStalledAttempts } from './attempt-log'
import { failure } from './generation-errors'
import { GenerationProducer } from './generation.producer'
import { GENERATION_TIMING, type GenerationTiming } from './generation.queue'

/**
 * The worker's queue recovery (backend architecture §5): on start and then periodically, every CV
 * in progress whose latest job BullMQ no longer runs (Redis was wiped, the enqueue failed) gets
 * that job back on the queue, under the same jobId, so nothing stays in progress forever.
 */
@Injectable()
export class QueueRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null
  private sweeping = false

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly cvs: CvsService,
    private readonly statuses: CvStatusService,
    @Inject(GENERATION_TIMING) private readonly timing: GenerationTiming,
    private readonly producer: GenerationProducer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueRecoveryService.name)
  }

  /** Not awaited: with Redis down the sweep waits for it, and the start must not. */
  onApplicationBootstrap(): void {
    void this.sweep()
    this.timer = setInterval(() => void this.sweep(), this.timing.recoveryMs)
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** One pass. Never throws: a failed pass is logged and the next one tries again. */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      for (const job of await this.cvs.latestJobsInProgress()) await this.recover(job)
    } catch (err) {
      this.logger.error({ err: safeError(err) }, 'queue recovery failed; the next pass retries')
    } finally {
      this.sweeping = false
    }
  }

  /**
   * A generating CV whose job BullMQ gave up on (it stalled too often, or its last failure was
   * never written) is failed, so the user can Retry; running it again could loop forever. Any
   * other CV in progress without a live job gets the job back.
   */
  private async recover(job: { jobId: string; cvId: string; status: CvStatus }): Promise<void> {
    const fate = await this.producer.fateOf(job.jobId)
    if (fate === 'live') return
    const ids = { cvId: job.cvId, jobId: job.jobId }
    if (fate === 'failed' && job.status === 'generating') {
      const failed = await this.db.transaction(async (tx) => {
        await closeStalledAttempts(job.jobId, tx)
        return this.statuses.transition(job.cvId, 'failed', {
          changes: failure('INTERNAL'),
          from: ['generating'],
          executor: tx,
        })
      })
      if (failed) this.logger.error(ids, 'generation job failed without its CV; CV failed')
      return
    }
    await this.producer.requeue(job.jobId, job.cvId)
    this.logger.warn(ids, 'lost generation job put back on the queue')
  }
}

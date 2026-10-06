import { eq, inArray, sql } from 'drizzle-orm'
import type { Executor } from '../database/database.module'
import { cvs, generationJobs } from '../database/schema'

/**
 * The place of each given CV in the queue: 1 + the queued CVs of every user whose latest job was
 * written before its own (ties broken by id). The job, not the CV, sets the order: BullMQ puts a
 * retried CV at the end, so it waits behind everything queued before the retry. CVs that are not
 * queued are absent from the map.
 */
export const queuePositions = async (
  cvIds: readonly string[],
  executor: Executor,
): Promise<Map<string, number>> => {
  if (cvIds.length === 0) return new Map()
  const queue = executor
    .select({
      id: cvs.id,
      position:
        sql<number>`row_number() over (order by max(${generationJobs.createdAt}), ${cvs.id})`
          .mapWith(Number)
          .as('position'),
    })
    .from(cvs)
    .innerJoin(generationJobs, eq(generationJobs.cvId, cvs.id))
    .where(eq(cvs.status, 'queued'))
    .groupBy(cvs.id)
    .as('queue')
  const rows = await executor
    .select()
    .from(queue)
    .where(inArray(queue.id, [...cvIds]))
  return new Map(rows.map((row) => [row.id, row.position]))
}

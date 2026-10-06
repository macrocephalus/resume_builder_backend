import { eq, inArray, sql } from 'drizzle-orm'
import type { Executor } from '../database/database.module'
import { cvs } from '../database/schema'

/**
 * The place of each given CV in the queue: 1 + the queued CVs of every user created before it
 * (ties broken by id). CVs that are not queued are absent from the map.
 */
export const queuePositions = async (
  cvIds: readonly string[],
  executor: Executor,
): Promise<Map<string, number>> => {
  if (cvIds.length === 0) return new Map()
  const queue = executor
    .select({
      id: cvs.id,
      position: sql<number>`row_number() over (order by ${cvs.createdAt}, ${cvs.id})`
        .mapWith(Number)
        .as('position'),
    })
    .from(cvs)
    .where(eq(cvs.status, 'queued'))
    .as('queue')
  const rows = await executor
    .select()
    .from(queue)
    .where(inArray(queue.id, [...cvIds]))
  return new Map(rows.map((row) => [row.id, row.position]))
}

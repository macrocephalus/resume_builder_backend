import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CvStatusService } from '../src/cvs/cv-status.service'
import { DATABASE, type Database } from '../src/database/database.module'
import { cvs } from '../src/database/schema'
import { type TestApp, createTestApp } from './helpers/app'
import { signUp } from './helpers/auth'
import { createCv } from './helpers/cvs'

describe('CvStatusService: the only writer of cvs.status', () => {
  let app: TestApp
  let db: Database
  let statuses: CvStatusService

  beforeAll(async () => {
    app = await createTestApp()
    db = app.app.get<Database>(DATABASE)
    statuses = app.app.get(CvStatusService)
  })

  afterAll(() => app.close())

  const queuedCv = async () => {
    const { cookie } = await signUp(app.server())
    return (await createCv(app.server(), cookie)).id
  }

  const stored = async (id: string) => {
    const [row] = await db.select().from(cvs).where(eq(cvs.id, id))
    return row
  }

  it('makes an allowed move with the columns that go with it and touches updatedAt', async () => {
    const id = await queuedCv()
    const before = await stored(id)

    expect(await statuses.transition(id, 'generating', { changes: { stage: 'drafting' } })).toBe(
      true,
    )
    const after = await stored(id)
    expect(after).toMatchObject({ status: 'generating', stage: 'drafting' })
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity)

    expect(await statuses.transition(id, 'ready', { changes: { stage: null } })).toBe(true)
    expect(await stored(id)).toMatchObject({ status: 'ready', stage: null })
  })

  it('changes nothing for a move the status machine does not allow from the current status', async () => {
    const id = await queuedCv()
    expect(await statuses.transition(id, 'ready')).toBe(false)
    expect(await statuses.transition(id, 'retrying', { changes: { error: 'stale' } })).toBe(false)
    expect(await stored(id)).toMatchObject({ status: 'queued', error: null })
  })

  it('is a compare-and-set: of two writers making the same move, only the first wins', async () => {
    const id = await queuedCv()
    expect(await statuses.transition(id, 'generating')).toBe(true)
    expect(await statuses.transition(id, 'generating')).toBe(false)
  })

  it('narrows the move to the given from-statuses, and refuses ones the machine forbids', async () => {
    const id = await queuedCv()
    await statuses.transition(id, 'generating')
    await statuses.transition(id, 'needs_input')
    // a stale save of a generation: only a generating CV may take it
    expect(await statuses.transition(id, 'ready', { from: ['generating'] })).toBe(false)
    expect(await stored(id)).toMatchObject({ status: 'needs_input' })
    await expect(statuses.transition(id, 'ready', { from: ['queued'] })).rejects.toThrow(
      'queued → ready',
    )
  })

  it('resumes a generating CV for a re-run of its job, and nothing else', async () => {
    const id = await queuedCv()
    expect(await statuses.resumeGenerating(id, { attempt: 2, stage: 'drafting' })).toBe(false)
    await statuses.transition(id, 'generating', { changes: { stage: 'revising' } })
    expect(await statuses.resumeGenerating(id, { attempt: 2, stage: 'drafting' })).toBe(true)
    expect(await stored(id)).toMatchObject({ status: 'generating', attempt: 2, stage: 'drafting' })
  })

  it('reports false for a CV that was deleted meanwhile', async () => {
    const id = await queuedCv()
    await db.delete(cvs).where(eq(cvs.id, id))
    expect(await statuses.transition(id, 'generating')).toBe(false)
  })

  it("joins the caller's transaction and is undone with it", async () => {
    const id = await queuedCv()
    await expect(
      db.transaction(async (tx) => {
        expect(await statuses.transition(id, 'generating', { executor: tx })).toBe(true)
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await stored(id)).toMatchObject({ status: 'queued' })
  })
})

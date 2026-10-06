import type { DraftSubmission } from '../agents/draft/draft-submission.schema'
import { describe, expect, it } from 'vitest'
import { SOURCE_TEXT, completeSubmission } from '../../test/helpers/model'
import { type DraftContext, prepareDraft } from './prepare-draft'

let next = 0
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

const context: DraftContext = { source: SOURCE_TEXT, facts: [], language: 'en' }

/** `completeSubmission` with what the source doesn't back: a bullet, a year, a skill. */
const unbacked = (): DraftSubmission => {
  const submission = completeSubmission()
  const [job] = submission.cv.experience
  job?.bullets.push('Led a team of 12 engineers')
  if (job) job.period = '2017 – present'
  submission.cv.skills.push('Kubernetes')
  return submission
}

describe('prepareDraft', () => {
  it('saves a backed draft as it came, without questions, every bullet counted as verified', () => {
    const draft = prepareDraft(completeSubmission(), context, newId)
    expect(draft.questions).toEqual([])
    expect(draft.data.experience[0]?.bullets).toEqual(
      completeSubmission().cv.experience[0]?.bullets,
    )
    expect(draft.verification).toEqual({
      verified: 2,
      sentToConfirm: 0,
      skillsToConfirm: 0,
      cleared: 0,
    })
  })

  it('takes out what the source does not back and asks about it, with the counts', () => {
    const { data, questions, verification } = prepareDraft(unbacked(), context, newId)
    const [job] = data.experience
    expect(job).toMatchObject({
      period: null,
      bullets: completeSubmission().cv.experience[0]?.bullets,
    })
    expect(data.skills).toEqual(['Node.js', 'PostgreSQL'])
    expect(questions.map((q) => [q.origin, q.kind, q.target])).toEqual([
      ['auto', 'text', { section: 'experience', itemId: job?.id, field: 'period' }],
      ['verifier', 'confirm', { section: 'experience', itemId: job?.id, field: 'bullets' }],
      ['verifier', 'multi', { section: 'skills' }],
    ])
    expect(questions[1]?.claim).toBe('Led a team of 12 engineers')
    expect(questions[2]?.options).toEqual(['Kubernetes'])
    expect(verification).toEqual({ verified: 2, sentToConfirm: 1, skillsToConfirm: 1, cleared: 1 })
  })

  it('counts a cleared field only when a question asks for it', () => {
    const submission = completeSubmission()
    submission.cv.contacts = {
      ...submission.cv.contacts,
      email: 'invented@example.com',
      phone: null,
      links: ['https://example.com/invented'],
    }
    // no email and no phone left: the auto question asks for the email; nothing asks for a link
    expect(prepareDraft(submission, context, newId).verification.cleared).toBe(1)
    // a phone the user gave is enough, so nobody asks for the cleared email
    submission.cv.contacts.phone = '+380671234567'
    const facts = [{ question: 'Your phone?', answer: '+380 67 123 45 67' }]
    expect(prepareDraft(submission, { ...context, facts }, newId).verification.cleared).toBe(0)
  })

  it('offers the uncovered skill requirements in the multi question', () => {
    const submission = completeSubmission()
    submission.requirements.push({ label: 'Terraform', kind: 'skill', keywords: ['terraform'] })
    const { questions, verification } = prepareDraft(submission, context, newId)
    // an uncovered experience requirement ("Kubernetes in production") is not a skill to tick
    expect(questions.find((q) => q.kind === 'multi')?.options).toEqual(['Terraform'])
    expect(verification.skillsToConfirm).toBe(0)
  })

  it('gives every requirement an id and keeps the suggested roles', () => {
    const draft = prepareDraft(completeSubmission(), context, newId)
    expect(draft.requirements.map((item) => item.label)).toEqual([
      'Node.js',
      'Kubernetes in production',
    ])
    expect(new Set(draft.requirements.map((item) => item.id)).size).toBe(2)
    expect(draft.suggestedRoles).toEqual(['Node.js Tech Lead'])
  })

  it('asks the auto questions of the final draft in the CV language, the model ones last', () => {
    const submission = completeSubmission()
    submission.cv.summary = null
    submission.questions = [
      {
        kind: 'choice',
        text: 'Your English level?',
        label: 'English',
        options: ['B2', 'C1'],
        target: { section: 'languages', itemIndex: 0, field: 'level' },
      },
    ]
    const { questions } = prepareDraft(submission, { ...context, language: 'uk' }, newId)
    expect(questions.map((q) => [q.origin, q.target.section])).toEqual([
      ['auto', 'summary'],
      ['model', 'languages'],
    ])
    expect(questions[0]?.text).toMatch(/[а-яіїє]/i)
  })
})

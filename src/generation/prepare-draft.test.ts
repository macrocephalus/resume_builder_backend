import { describe, expect, it } from 'vitest'
import { completeSubmission } from '../../test/helpers/model'
import { prepareDraft } from './prepare-draft'

let next = 0
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

describe('prepareDraft', () => {
  it('counts every bullet as verified until the verifier lands', () => {
    const submission = completeSubmission()
    submission.cv.projects.push({
      name: 'pg-outbox',
      period: '2023',
      url: null,
      bullets: ['Outbox'],
    })
    expect(prepareDraft(submission, 'en', newId).verification).toEqual({
      verified: 3,
      sentToConfirm: 0,
      skillsToConfirm: 0,
      cleared: 0,
    })
  })

  it('gives every requirement an id and keeps the suggested roles', () => {
    const draft = prepareDraft(completeSubmission(), 'en', newId)
    expect(draft.requirements.map((item) => item.label)).toEqual(['Node.js', 'Kubernetes'])
    expect(new Set(draft.requirements.map((item) => item.id)).size).toBe(2)
    expect(draft.suggestedRoles).toEqual(['Node.js Tech Lead'])
  })

  it('asks the auto questions of the final draft in the CV language, the model ones after', () => {
    const submission = completeSubmission()
    submission.cv.summary = null
    submission.questions = [
      {
        kind: 'text',
        text: 'Any open source?',
        label: 'Projects',
        target: { section: 'projects' },
      },
    ]
    const { questions } = prepareDraft(submission, 'uk', newId)
    expect(questions.map((q) => [q.origin, q.target.section])).toEqual([
      ['auto', 'summary'],
      ['model', 'projects'],
    ])
    expect(questions[0]?.text).toMatch(/[а-яіїє]/i)
  })

  it('has no questions for a complete draft', () => {
    expect(prepareDraft(completeSubmission(), 'en', newId).questions).toEqual([])
  })
})

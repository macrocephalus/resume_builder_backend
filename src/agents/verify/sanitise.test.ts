import { describe, expect, it } from 'vitest'
import type { DraftSubmission } from '../draft/draft-submission.schema'
import { sanitise } from './sanitise'
import { type Problem, verifyDraft } from './verify-draft'

const SOURCE = [
  'Olena Hnatiuk, olena@example.com, github.com/olena',
  'Backend engineer at Fintory, 2019 – 2024. Moved card authorisations to an outbox pattern.',
  'Node.js, PostgreSQL. English.',
].join('\n')

const submission = (): DraftSubmission => ({
  cv: {
    contacts: {
      fullName: 'Olena Hnatiuk',
      email: 'olena.h@example.com',
      phone: null,
      location: null,
      links: ['github.com/olena', 'linkedin.com/in/olena'],
    },
    summary: 'Backend engineer at Fintory. Led a team of 12 on Kubernetes. Writes Node.js.',
    experience: [
      {
        title: 'Backend Engineer',
        company: 'Fintory',
        period: '2017 – 2024',
        bullets: ['Moved card authorisations to an outbox pattern', 'Led a team of 12 engineers'],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    skills: ['Node.js', 'Kubernetes', 'PostgreSQL'],
    languages: [{ name: 'English', level: 'C1' }],
    sectionOrder: [
      'summary',
      'experience',
      'skills',
      'projects',
      'education',
      'certifications',
      'languages',
    ],
  },
  evidence: [
    { path: 'experience[0].bullets[0]', quote: 'Moved card authorisations to an outbox pattern' },
  ],
  questions: [
    {
      kind: 'text',
      text: 'Which degree?',
      label: 'Degree',
      target: { section: 'education', itemIndex: 0, field: 'degree' },
    },
    {
      kind: 'choice',
      text: 'Your English level?',
      label: 'English',
      options: ['B2', 'C1'],
      target: { section: 'languages', itemIndex: 0, field: 'level' },
    },
  ],
  requirements: [
    { label: 'Kafka', kind: 'skill', keywords: ['kafka'] },
    { label: 'Cloud', kind: 'skill', keywords: [' '] },
  ],
  suggestedRoles: ['Payments Engineer', ' '],
})

const run = (draft: DraftSubmission, problems: Problem[] = verifyDraft(draft, SOURCE, [])) =>
  sanitise(draft, problems)

describe('sanitise', () => {
  it('changes nothing when there are no problems', () => {
    const draft = submission()
    expect(run(draft, [])).toEqual({ submission: draft, claims: [], cleared: [], skills: [] })
  })

  it('removes a failed bullet and returns it as a claim to confirm', () => {
    const { submission: clean, claims } = run(submission())
    expect(clean.cv.experience[0]?.bullets).toEqual([
      'Moved card authorisations to an outbox pattern',
    ])
    expect(claims).toEqual([
      { section: 'experience', itemIndex: 0, claim: 'Led a team of 12 engineers' },
    ])
  })

  it('clears a failed field, contact and link, and lists what it cleared', () => {
    const { submission: clean, cleared } = run(submission())
    expect(clean.cv.experience[0]).toMatchObject({ company: 'Fintory', period: null })
    expect(clean.cv.languages[0]).toEqual({ name: 'English', level: null })
    expect(clean.cv.contacts).toMatchObject({ email: null, links: ['github.com/olena'] })
    expect(cleared).toEqual([
      { section: 'contacts', field: 'email' },
      { section: 'contacts', field: 'links' },
      { section: 'experience', itemIndex: 0, field: 'period' },
      { section: 'languages', itemIndex: 0, field: 'level' },
    ])
  })

  it('removes an unconfirmed skill and returns it as a suggestion', () => {
    const { submission: clean, skills } = run(submission())
    expect(clean.cv.skills).toEqual(['Node.js', 'PostgreSQL'])
    expect(skills).toEqual(['Kubernetes'])
  })

  it('drops the summary sentences with an unverified number or technology', () => {
    expect(run(submission()).submission.cv.summary).toBe(
      'Backend engineer at Fintory. Writes Node.js.',
    )
    const draft = submission()
    draft.cv.summary = 'Led a team of 12 on Kubernetes.'
    expect(run(draft).submission.cv.summary).toBeNull()
  })

  it('drops questions without a target, invalid requirements and blank roles', () => {
    const { submission: clean } = run(submission())
    expect(clean.questions.map((question) => question.label)).toEqual(['English'])
    expect(clean.requirements.map((requirement) => requirement.label)).toEqual(['Kafka'])
    expect(clean.suggestedRoles).toEqual(['Payments Engineer'])
  })

  it('leaves a sanitised draft with nothing left to verify', () => {
    const { submission: clean } = run(submission())
    expect(verifyDraft(clean, SOURCE, [])).toEqual([])
  })
})

import type { CvData, Requirement } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { buildVerifierQuestions } from './build-verifier-questions'

const JOB = '11111111-1111-4111-8111-111111111111'
const SCHOOL = '22222222-2222-4222-8222-222222222222'
const ENGLISH = '33333333-3333-4333-8333-333333333333'

const data = (): CvData => ({
  contacts: { fullName: 'Olena', email: 'o@example.com', phone: null, location: null, links: [] },
  summary: 'Backend engineer.',
  experience: [
    { id: JOB, title: 'Backend Engineer', company: 'Fintory', period: null, bullets: [] },
  ],
  projects: [],
  education: [{ id: SCHOOL, institution: 'KPI', degree: null, period: '2015' }],
  certifications: [],
  skills: ['Node.js'],
  languages: [{ id: ENGLISH, name: 'English', level: null }],
  sectionOrder: [
    'summary',
    'experience',
    'projects',
    'education',
    'certifications',
    'skills',
    'languages',
  ],
})

const requirement = (label: string, kind: Requirement['kind'] = 'skill'): Requirement => ({
  id: `00000000-0000-4000-8000-${String(label.length).padStart(12, '0')}`,
  label,
  kind,
  keywords: [label.toLowerCase()],
})

const ids: Record<string, string[]> = {
  experience: [JOB, ''],
  education: [SCHOOL],
  languages: [ENGLISH],
}
const itemIdOf = (section: string, index: number) => ids[section]?.[index] || undefined

const build = (overrides: Partial<Parameters<typeof buildVerifierQuestions>[0]> = {}) =>
  buildVerifierQuestions({
    data: data(),
    claims: [],
    cleared: [],
    skills: [],
    requirements: [],
    language: 'en',
    itemIdOf,
    ...overrides,
  })

describe('buildVerifierQuestions', () => {
  it('offers each removed bullet back as a yes/no claim about its job', () => {
    const { confirm } = build({
      claims: [
        { section: 'experience', itemIndex: 0, claim: 'Led a team of 12 engineers' },
        // the job was dropped as empty: there is nowhere to put the claim back
        { section: 'experience', itemIndex: 1, claim: 'Cut costs by 30%' },
      ],
    })
    expect(confirm).toEqual([
      {
        kind: 'confirm',
        origin: 'verifier',
        text: 'Your text does not say this. Should it stay in the CV?',
        label: 'Fintory',
        options: [],
        claim: 'Led a team of 12 engineers',
        target: { section: 'experience', itemId: JOB, field: 'bullets' },
      },
    ])
  })

  it('asks about a cleared field, a level as a choice, and leaves the rest to the auto questions', () => {
    const { cleared } = build({
      cleared: [
        { section: 'contacts', field: 'email' },
        { section: 'experience', itemIndex: 0, field: 'period' },
        { section: 'education', itemIndex: 0, field: 'degree' },
        { section: 'languages', itemIndex: 0, field: 'level' },
      ],
    })
    expect(cleared.map((q) => [q.kind, q.label, q.text, q.target])).toEqual([
      [
        'text',
        'Degree',
        'KPI: Your text does not confirm what was written here. What should it say?',
        { section: 'education', itemId: SCHOOL, field: 'degree' },
      ],
      [
        'choice',
        'Level',
        'English: Your text does not confirm what was written here. What should it say?',
        { section: 'languages', itemId: ENGLISH, field: 'level' },
      ],
    ])
    expect(cleared[1]?.options).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'])
  })

  it('offers unconfirmed skills and the uncovered skill requirements in one question', () => {
    const { multi } = build({
      skills: ['Kubernetes', 'Kafka'],
      requirements: [
        requirement('Node.js'),
        requirement('kafka'),
        requirement('Terraform'),
        requirement('Team leadership', 'experience'),
      ],
    })
    expect(multi).toEqual({
      kind: 'multi',
      origin: 'verifier',
      text: 'Which of these have you worked with? Only what you tick goes into the CV.',
      label: 'Skills',
      options: ['Kubernetes', 'Kafka', 'Terraform'],
      claim: null,
      target: { section: 'skills' },
    })
  })

  it('keeps at most 8 options and has no question without one', () => {
    const skills = Array.from({ length: 10 }, (_, index) => `Skill ${index}`)
    expect(build({ skills }).multi?.options).toEqual(skills.slice(0, 8))
    expect(build().multi).toBeNull()
  })

  it('words the questions in the CV language', () => {
    const { confirm, multi } = build({
      language: 'uk',
      claims: [{ section: 'experience', itemIndex: 0, claim: 'Очолювала команду з 12 людей' }],
      skills: ['Kubernetes'],
    })
    expect(confirm[0]?.text).toBe('У вашому тексті цього немає. Залишити це в резюме?')
    expect(multi?.label).toBe('Навички')
  })
})

import type { CvData } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { buildAutoQuestions } from './build-auto-questions'

const JOB = '11111111-1111-4111-8111-111111111111'

const empty = (): CvData => ({
  contacts: { fullName: null, email: null, phone: null, location: null, links: [] },
  summary: null,
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: [],
  languages: [],
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

describe('buildAutoQuestions', () => {
  it('asks for every missing required part, email and phone as two questions', () => {
    const questions = buildAutoQuestions(empty(), 'en')
    expect(questions.map((q) => q.target)).toEqual([
      { section: 'contacts', field: 'fullName' },
      { section: 'contacts', field: 'email' },
      { section: 'contacts', field: 'phone' },
      { section: 'summary' },
      { section: 'experience' },
      { section: 'skills' },
    ])
    expect(questions.every((q) => q.kind === 'text' && q.origin === 'auto')).toBe(true)
    expect(questions[0]).toMatchObject({ label: 'Full name', options: [], claim: null })
  })

  it('words the questions in the CV language and names the item a field belongs to', () => {
    const data: CvData = {
      ...empty(),
      contacts: { ...empty().contacts, fullName: 'Олена', email: 'o@example.com' },
      summary: 'Бекенд-інженерка.',
      skills: ['Node.js'],
      experience: [{ id: JOB, title: null, company: 'Fintory', period: '2019', bullets: [] }],
    }
    const [question, ...rest] = buildAutoQuestions(data, 'uk')
    expect(rest).toEqual([])
    expect(question?.target).toEqual({ section: 'experience', itemId: JOB, field: 'title' })
    expect(question?.text).toMatch(/^Fintory: /)
    expect(question?.text).not.toMatch(/[A-Za-z]{4,}\?$/)
  })

  it('asks nothing about a complete draft', () => {
    const data: CvData = {
      ...empty(),
      contacts: { ...empty().contacts, fullName: 'Olena', phone: '+380' },
      summary: 'Engineer.',
      skills: ['Go'],
      experience: [{ id: JOB, title: 'Dev', company: 'Fintory', period: '2019', bullets: [] }],
    }
    expect(buildAutoQuestions(data, 'en')).toEqual([])
  })
})

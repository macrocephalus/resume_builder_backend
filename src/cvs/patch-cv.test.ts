import type { CvData, QuestionTarget } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { patchCv } from './patch-cv'

const JOB = '11111111-1111-4111-8111-111111111111'
const SCHOOL = '22222222-2222-4222-8222-222222222222'

const draft = (): CvData => ({
  contacts: { fullName: 'Olena', email: null, phone: null, location: null, links: ['', 'a.dev'] },
  summary: null,
  experience: [
    { id: JOB, title: 'Engineer', company: null, period: null, bullets: ['Built', ' '] },
  ],
  projects: [],
  education: [{ id: SCHOOL, institution: null, degree: null, period: null }],
  certifications: [],
  skills: ['Go', ''],
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

const open = (id: string, target: QuestionTarget) => ({ id, target })

describe('patchCv', () => {
  it('drops empty items and blank bullets, skills and links', () => {
    const { data } = patchCv(draft(), [])
    expect(data.education).toEqual([])
    expect(data.experience[0]?.bullets).toEqual(['Built'])
    expect(data.skills).toEqual(['Go'])
    expect(data.contacts.links).toEqual(['a.dev'])
  })

  it('skips the open questions about items no longer in the draft, the dropped empty ones too', () => {
    const removed = draft()
    removed.experience = []
    const { toSkip } = patchCv(removed, [
      open('job', { section: 'experience', itemId: JOB, field: 'company' }),
      open('school', { section: 'education', itemId: SCHOOL, field: 'institution' }),
      open('phone', { section: 'contacts', field: 'phone' }),
      open('experience', { section: 'experience' }),
    ])
    expect(toSkip).toEqual(['job', 'school'])
  })

  it('keeps a question whose field was filled by hand', () => {
    const filled = draft()
    filled.contacts.phone = '+380 67 123'
    const job = filled.experience[0]
    if (job) job.company = 'Fintory'
    const { toSkip } = patchCv(filled, [
      open('phone', { section: 'contacts', field: 'phone' }),
      open('company', { section: 'experience', itemId: JOB, field: 'company' }),
    ])
    expect(toSkip).toEqual([])
  })
})

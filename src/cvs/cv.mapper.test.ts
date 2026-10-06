import type { CvData, Requirement } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { AppError } from '../common/errors/app-error'
import { type CvRow, type QuestionRow, toCv, toStatusInfo, toSummary } from './cv.mapper'

const CREATED = new Date('2026-10-06T10:00:00.000Z')
const UPDATED = new Date('2026-10-06T10:05:00.000Z')

const row = (overrides: Partial<CvRow> = {}): CvRow => ({
  id: '0b6f9e44-6f0a-4c39-9d43-1d6f3c1d7a01',
  userId: '7c1f0d0e-3b44-4d8b-9b0f-2d9a6c8e4f11',
  parentCvId: null,
  title: 'Backend',
  targetRole: 'Senior Backend Engineer',
  roleContext: null,
  language: 'en',
  sourceType: 'text',
  sourceFilename: null,
  sourceText: 'never leaves the server',
  facts: [],
  status: 'queued',
  stage: null,
  attempt: 1,
  maxAttempts: 3,
  errorCode: null,
  error: null,
  data: null,
  requirements: [],
  suggestedRoles: [],
  verification: null,
  version: 0,
  createdAt: CREATED,
  updatedAt: UPDATED,
  ...overrides,
})

const draft = (): CvData => ({
  contacts: { fullName: 'Olena', email: null, phone: null, location: null, links: [] },
  summary: 'Backend engineer, Node.js and PostgreSQL.',
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: ['Node.js'],
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

const requirement = (label: string, keyword: string): Requirement => ({
  id: crypto.randomUUID(),
  label,
  kind: 'skill',
  keywords: [keyword],
})

const question = (overrides: Partial<QuestionRow>): QuestionRow => ({
  id: crypto.randomUUID(),
  cvId: row().id,
  kind: 'text',
  origin: 'auto',
  text: 'Your phone?',
  label: 'Phone',
  options: null,
  claim: null,
  target: { section: 'contacts', field: 'phone' },
  status: 'open',
  answer: null,
  position: 1,
  createdAt: CREATED,
  answeredAt: null,
  ...overrides,
})

describe('toStatusInfo', () => {
  it('keeps the light fields, timestamps as ISO strings, the queue position only while queued', () => {
    expect(toStatusInfo(row(), 4)).toEqual({
      id: row().id,
      status: 'queued',
      stage: null,
      attempt: 1,
      maxAttempts: 3,
      queuePosition: 4,
      errorCode: null,
      error: null,
      updatedAt: '2026-10-06T10:05:00.000Z',
    })
    expect(toStatusInfo(row({ status: 'generating', stage: 'drafting' }), 4)).toMatchObject({
      queuePosition: null,
      stage: 'drafting',
    })
  })
})

describe('toCv', () => {
  it('leaves the source text and facts out, and orders questions open first, then by position', () => {
    const questions = [
      question({ position: 1, status: 'answered', answer: { kind: 'text', value: '+380' } }),
      question({ position: 3, status: 'open', kind: 'multi', options: ['Go', 'Rust'] }),
      question({ position: 2, status: 'open' }),
    ]
    const cv = toCv(row(), questions, 1)
    expect(cv).not.toHaveProperty('sourceText')
    expect(cv).not.toHaveProperty('facts')
    expect(cv.questions.map((q) => [q.status, q.answer, q.options])).toEqual([
      ['open', null, []],
      ['open', null, ['Go', 'Rust']],
      ['answered', '+380', []],
    ])
    expect(cv.createdAt).toBe('2026-10-06T10:00:00.000Z')
  })

  it('is 500 DATA_CORRUPT when the stored draft does not match the schema', () => {
    const corrupt = row({ status: 'ready', data: { contacts: 'broken' } as unknown as CvData })
    expect(() => toCv(corrupt, [], null)).toThrow(AppError)
    try {
      toCv(corrupt, [], null)
    } catch (error) {
      expect(error).toMatchObject({ status: 500, code: 'DATA_CORRUPT' })
    }
  })
})

describe('toSummary', () => {
  it('has no match before a draft', () => {
    expect(toSummary(row(), 0)).toMatchObject({ match: null, openQuestions: 0 })
  })

  it('keeps the list readable when one stored draft is corrupt: that item has no match', () => {
    const corrupt = row({ status: 'ready', data: { contacts: 'broken' } as unknown as CvData })
    expect(toSummary(corrupt, 0)).toMatchObject({ status: 'ready', match: null })
  })

  it('computes the match of the draft against the requirements with the shared rule', () => {
    const summary = toSummary(
      row({
        status: 'needs_input',
        data: draft(),
        requirements: [requirement('Node.js', 'node.js'), requirement('Kubernetes', 'kubernetes')],
      }),
      2,
    )
    expect(summary).toEqual({
      id: row().id,
      title: 'Backend',
      targetRole: 'Senior Backend Engineer',
      language: 'en',
      status: 'needs_input',
      openQuestions: 2,
      match: { covered: 1, total: 2 },
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:05:00.000Z',
    })
  })
})

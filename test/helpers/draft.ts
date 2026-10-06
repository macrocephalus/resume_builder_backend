import { randomUUID } from 'node:crypto'
import { CV_LIMITS, type CvData, type QuestionKind } from '@cv/shared'
import { eq } from 'drizzle-orm'
import { DATABASE, type Database } from '../../src/database/database.module'
import { cvQuestions, cvs } from '../../src/database/schema'
import type { NewQuestion } from '../../src/questions/new-question'
import type { TestApp } from './app'
import { signUp } from './auth'
import { createCv } from './cvs'

/** The id of the one job in `draft()`. */
export const JOB = '11111111-1111-4111-8111-111111111111'

/** A finished draft: contacts without a phone, one job, one skill. */
export const draft = (): CvData => ({
  contacts: {
    fullName: 'Olena Hnatiuk',
    email: 'olena@example.com',
    phone: null,
    location: 'Kyiv',
    links: [],
  },
  summary: 'Backend engineer with eight years of Node.js and PostgreSQL in payments.',
  experience: [
    {
      id: JOB,
      title: 'Backend Engineer',
      company: 'Fintory',
      period: '2019 – present',
      bullets: ['Built the payments API'],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  skills: ['PostgreSQL'],
  languages: [],
  sectionOrder: [
    'summary',
    'experience',
    'skills',
    'projects',
    'education',
    'certifications',
    'languages',
  ],
})

/**
 * A draft with every list and every field at its `CV_LIMITS` maximum, written in CJK: 3 bytes
 * per UTF-16 unit in JSON, the most a field's length allows without escapes.
 */
export const fullDraft = (): CvData => {
  const text = (length: number) => '字'.repeat(length)
  const times = <T>(count: number, item: () => T): T[] => Array.from({ length: count }, item)
  const short = () => text(CV_LIMITS.shortText)
  const bullets = () => times(CV_LIMITS.bullets, () => text(CV_LIMITS.bullet))
  return {
    contacts: {
      fullName: short(),
      email: short(),
      phone: short(),
      location: short(),
      links: times(CV_LIMITS.links, () => text(CV_LIMITS.link)),
    },
    summary: text(CV_LIMITS.summary),
    experience: times(CV_LIMITS.experience, () => ({
      id: randomUUID(),
      title: short(),
      company: short(),
      period: short(),
      bullets: bullets(),
    })),
    projects: times(CV_LIMITS.projects, () => ({
      id: randomUUID(),
      name: short(),
      period: short(),
      url: text(CV_LIMITS.link),
      bullets: bullets(),
    })),
    education: times(CV_LIMITS.education, () => ({
      id: randomUUID(),
      institution: short(),
      degree: short(),
      period: short(),
    })),
    certifications: times(CV_LIMITS.certifications, () => ({
      id: randomUUID(),
      name: short(),
      issuer: short(),
      year: short(),
    })),
    skills: times(CV_LIMITS.skills, () => text(CV_LIMITS.skill)),
    languages: times(CV_LIMITS.languages, () => ({
      id: randomUUID(),
      name: short(),
      level: short(),
    })),
    sectionOrder: draft().sectionOrder,
  }
}

export const question = (
  kind: QuestionKind,
  target: NewQuestion['target'],
  rest: Partial<NewQuestion> = {},
): NewQuestion => ({
  kind,
  origin: kind === 'text' ? 'auto' : 'verifier',
  text: `A ${kind} question?`,
  label: 'Label',
  options: [],
  claim: null,
  target,
  ...rest,
})

/**
 * A CV of a new user as a finished generation leaves it: `needs_input`, version 1, `draft()` and
 * `questions` open in that order. Returns the cookie, the CV id and the question ids.
 */
export const needsInput = async (app: TestApp, ...questions: NewQuestion[]) => {
  const db = app.app.get<Database>(DATABASE)
  const { cookie } = await signUp(app.server(), `${randomUUID()}@example.com`)
  const { id } = await createCv(app.server(), cookie)
  await db
    .update(cvs)
    .set({ status: 'needs_input', data: draft(), version: 1 })
    .where(eq(cvs.id, id))
  const rows =
    questions.length === 0
      ? []
      : await db
          .insert(cvQuestions)
          .values(questions.map((q, index) => ({ ...q, cvId: id, position: index + 1 })))
          .returning({ id: cvQuestions.id })
  return { cookie, id, questionIds: rows.map((row) => row.id) }
}

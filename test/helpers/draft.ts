import { randomUUID } from 'node:crypto'
import type { CvData, QuestionKind } from '@cv/shared'
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

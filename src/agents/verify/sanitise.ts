import type { ItemSection } from '@cv/shared'
import type { DraftSubmission } from '../draft/draft-submission.schema'
import { containsWord, normalise, numbersIn } from './normalise'
import { type BulletSection, type Problem, type ProblemTarget, pathOf } from './verify-draft'

/** A bullet the source doesn't back: removed, and offered back to the user as a yes/no claim. */
export type RemovedClaim = { section: BulletSection; itemIndex: number; claim: string }

/** A field set back to empty. Contacts are asked about by the auto questions, if at all. */
export type ClearedField =
  | { section: ItemSection; itemIndex: number; field: string }
  | { section: 'contacts'; field: string }

export type Sanitised = {
  /** What is left: everything in it passes `verifyDraft`. */
  submission: DraftSubmission
  claims: RemovedClaim[]
  cleared: ClearedField[]
  /** Skills the source doesn't name, as the model wrote them. */
  skills: string[]
}

const withoutIndexes = <T>(list: readonly T[], drop: ReadonlySet<number>): T[] =>
  list.filter((_, index) => !drop.has(index))

/** Sentences of the summary that mention none of `tokens`; `null` when none is left. */
const summaryWithout = (summary: string | null, tokens: readonly string[]): string | null => {
  if (summary === null || tokens.length === 0) return summary
  const kept = summary
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => {
      const text = normalise(sentence)
      const numbers = numbersIn(text)
      return !tokens.some((token) => numbers.includes(token) || containsWord(text, token))
    })
    .join(' ')
    .trim()
  return kept === '' ? null : kept
}

/**
 * The last submission of the loop with what still fails verification taken out (backend
 * architecture §4): a failed bullet is removed and returned as a claim, a failed field, contact
 * or link is cleared, a failed skill is removed and returned, a summary sentence with an
 * unverified number or technology is dropped, and questions, requirements and roles that are
 * invalid are dropped. Pure; the questions about what was taken out are built from the result.
 */
export const sanitise = (submission: DraftSubmission, problems: readonly Problem[]): Sanitised => {
  const failed = new Set(problems.map(({ target }) => pathOf(target)))
  const failedAt = (target: ProblemTarget) => failed.has(pathOf(target))
  const indexesOf = (kind: 'link' | 'skill' | 'question' | 'requirement' | 'suggestedRole') =>
    new Set(
      problems.flatMap(({ target }) =>
        target.kind === kind && 'index' in target ? [target.index] : [],
      ),
    )

  const claims: RemovedClaim[] = []
  const cleared: ClearedField[] = []
  for (const { target } of problems) {
    if (target.kind === 'contact') cleared.push({ section: 'contacts', field: target.field })
    if (target.kind === 'link') cleared.push({ section: 'contacts', field: 'links' })
    if (target.kind === 'field') {
      const { section, itemIndex, field } = target
      cleared.push({ section, itemIndex, field })
    }
  }

  const { cv } = submission
  /** The item with its failed fields set to `null`; every field the verifier checks is nullable. */
  const clear = <T extends object>(item: T, section: ItemSection, itemIndex: number): T => ({
    ...item,
    ...Object.fromEntries(
      Object.keys(item)
        .filter((field) => failedAt({ kind: 'field', section, itemIndex, field }))
        .map((field) => [field, null]),
    ),
  })
  /** The bullets that passed; the others become claims. */
  const bullets = (section: BulletSection, itemIndex: number, list: readonly string[]) =>
    list.filter((claim, bulletIndex) => {
      if (!failedAt({ kind: 'bullet', section, itemIndex, bulletIndex })) return true
      claims.push({ section, itemIndex, claim })
      return false
    })

  const skillIndexes = indexesOf('skill')
  const summaryTokens = problems.flatMap(({ target }) =>
    target.kind === 'summary' ? [target.token] : [],
  )

  return {
    submission: {
      ...submission,
      cv: {
        ...cv,
        contacts: {
          ...cv.contacts,
          email: failedAt({ kind: 'contact', field: 'email' }) ? null : cv.contacts.email,
          phone: failedAt({ kind: 'contact', field: 'phone' }) ? null : cv.contacts.phone,
          links: withoutIndexes(cv.contacts.links, indexesOf('link')),
        },
        summary: summaryWithout(cv.summary, summaryTokens),
        experience: cv.experience.map((item, index) => ({
          ...clear(item, 'experience', index),
          bullets: bullets('experience', index, item.bullets),
        })),
        projects: cv.projects.map((item, index) => ({
          ...clear(item, 'projects', index),
          bullets: bullets('projects', index, item.bullets),
        })),
        education: cv.education.map((item, index) => clear(item, 'education', index)),
        certifications: cv.certifications.map((item, index) =>
          clear(item, 'certifications', index),
        ),
        skills: withoutIndexes(cv.skills, skillIndexes),
        languages: cv.languages.map((item, index) => clear(item, 'languages', index)),
      },
      questions: withoutIndexes(submission.questions, indexesOf('question')),
      requirements: withoutIndexes(submission.requirements, indexesOf('requirement')),
      suggestedRoles: withoutIndexes(submission.suggestedRoles, indexesOf('suggestedRole')),
    },
    claims,
    cleared,
    skills: cv.skills.filter((_, index) => skillIndexes.has(index)),
  }
}

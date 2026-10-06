import {
  AUTO_QUESTION_PARTS,
  type CvData,
  type CvLanguage,
  type ItemSection,
  type Requirement,
  computeMatch,
  getCvLanguage,
} from '@cv/shared'
import type { ClearedField, RemovedClaim } from '../agents/verify/sanitise'
import { QUESTIONS } from '../config/limits'
import { type ItemIdOf, type NewQuestion, questionTarget } from './new-question'
import { type ClearedPart, LANGUAGE_LEVELS, VERIFIER_WORDING } from './verifier-wording'

export type VerifierQuestions = {
  confirm: NewQuestion[]
  cleared: NewQuestion[]
  /** The one tick-what-applies skills question; `null` when there is nothing to offer. */
  multi: NewQuestion | null
}

export type VerifierQuestionsInput = {
  /** The final draft, with ids. */
  data: CvData
  claims: readonly RemovedClaim[]
  cleared: readonly ClearedField[]
  /** Skills removed because the source doesn't name them. */
  skills: readonly string[]
  requirements: readonly Requirement[]
  language: CvLanguage
  itemIdOf: ItemIdOf
}

const isClearedPart = (part: string): part is ClearedPart =>
  Object.hasOwn(VERIFIER_WORDING.en.labels, part)

// widened to string[] so `includes` takes any part; the list is only read
const isAutoPart = (part: string): boolean =>
  (AUTO_QUESTION_PARTS as readonly string[]).includes(part)

const nameOf = (...candidates: (string | null | undefined)[]): string | null =>
  candidates.find((value) => value != null && value.trim() !== '')?.trim() ?? null

/** What the user calls an item: a job by its company, a school by its degree, a language by name. */
const itemName = (data: CvData, section: ItemSection, itemId: string): string | null => {
  switch (section) {
    case 'experience': {
      const item = data.experience.find(({ id }) => id === itemId)
      return nameOf(item?.company, item?.title)
    }
    case 'projects':
      return nameOf(data.projects.find(({ id }) => id === itemId)?.name)
    case 'education': {
      const item = data.education.find(({ id }) => id === itemId)
      return nameOf(item?.degree, item?.institution)
    }
    case 'certifications':
      return nameOf(data.certifications.find(({ id }) => id === itemId)?.name)
    case 'languages':
      return nameOf(data.languages.find(({ id }) => id === itemId)?.name)
  }
}

/** Two spellings of one skill ("Kafka", "kafka ") have one key. */
export const skillKey = (skill: string): string => skill.trim().toLowerCase()

/** Unique case-insensitively, first spelling kept. */
const unique = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = skillKey(value)
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The verifier's questions about what `sanitise` took out of the draft (root architecture §6.5),
 * worded in the CV language: a `confirm` per removed bullet, a `text` (`choice` for a language
 * level) per cleared item field the auto questions don't ask about, and one `multi` with the
 * removed skills and the role's skill requirements the draft doesn't cover. Pure; a question about
 * an item that was dropped is left out.
 */
export const buildVerifierQuestions = ({
  data,
  claims,
  cleared,
  skills,
  requirements,
  language,
  itemIdOf,
}: VerifierQuestionsInput): VerifierQuestions => {
  const wording = VERIFIER_WORDING[language]
  const { headings } = getCvLanguage(language)

  const confirm = claims.flatMap(({ section, itemIndex, claim }): NewQuestion[] => {
    const itemId = itemIdOf(section, itemIndex)
    if (itemId === undefined) return []
    return [
      {
        kind: 'confirm',
        origin: 'verifier',
        text: wording.confirm,
        label: itemName(data, section, itemId) ?? headings[section],
        options: [],
        claim,
        target: questionTarget(section, itemId, 'bullets'),
      },
    ]
  })

  const clearedQuestions = cleared.flatMap((field): NewQuestion[] => {
    if (field.section === 'contacts') return []
    const part = `${field.section}.${field.field}`
    // an auto question asks for a cleared title, company, period of a job or institution
    if (isAutoPart(part) || !isClearedPart(part)) return []
    const itemId = itemIdOf(field.section, field.itemIndex)
    if (itemId === undefined) return []
    const name = itemName(data, field.section, itemId)
    const isLevel = part === 'languages.level'
    return [
      {
        kind: isLevel ? 'choice' : 'text',
        origin: 'verifier',
        text: name === null ? wording.cleared : `${name}: ${wording.cleared}`,
        label: wording.labels[part],
        options: isLevel ? [...LANGUAGE_LEVELS, wording.native] : [],
        claim: null,
        target: questionTarget(field.section, itemId, field.field),
      },
    ]
  })

  const uncovered = computeMatch(data, requirements)
    .items.filter((item) => item.kind === 'skill' && !item.covered)
    .map((item) => item.label)
  const options = unique([...skills, ...uncovered]).slice(0, QUESTIONS.multiOptions)

  return {
    confirm,
    cleared: clearedQuestions,
    multi:
      options.length === 0
        ? null
        : {
            kind: 'multi',
            origin: 'verifier',
            text: wording.multi,
            label: headings.skills,
            options,
            claim: null,
            target: questionTarget('skills', undefined, undefined),
          },
  }
}

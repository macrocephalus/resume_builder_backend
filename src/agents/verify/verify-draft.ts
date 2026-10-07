import { ITEM_SECTIONS, type ItemSection } from '@cv/shared'
import type {
  DraftSubmission,
  DraftWithoutIds,
  SubmissionTarget,
} from '../draft/draft-submission.schema'
import type { PromptFact } from '../prompt/prompt-fact'
import { containsWord, digitsOf, linkKey, normalise, numbersIn } from './normalise'
import { skillLikeWords } from './skill-like'

export const VERIFY_LIMITS = {
  /** A bullet's quote must be at least this long, so it can't be a stray word. */
  bulletQuote: 8,
  /** A name's or skill's quote ("Англійська" for "English") may be one short word, not a syllable. */
  nameQuote: 4,
} as const

export type BulletSection = 'experience' | 'projects'
const BULLET_SECTIONS = ['experience', 'projects'] as const satisfies readonly BulletSection[]

/** What a problem is about. `pathOf` writes it the way the model writes evidence paths. */
export type ProblemTarget =
  | { kind: 'bullet'; section: BulletSection; itemIndex: number; bulletIndex: number }
  | { kind: 'field'; section: ItemSection; itemIndex: number; field: string }
  | { kind: 'contact'; field: 'email' | 'phone' }
  | { kind: 'link'; index: number }
  | { kind: 'skill'; index: number }
  /** A number or a skill-like word of the summary, normalised. */
  | { kind: 'summary'; token: string }
  | { kind: 'question'; index: number }
  | { kind: 'requirement'; index: number }
  | { kind: 'suggestedRole'; index: number }

export type Problem = { target: ProblemTarget; reason: string }

export const pathOf = (target: ProblemTarget): string => {
  switch (target.kind) {
    case 'bullet':
      return `${target.section}[${target.itemIndex}].bullets[${target.bulletIndex}]`
    case 'field':
      return `${target.section}[${target.itemIndex}].${target.field}`
    case 'contact':
      return `contacts.${target.field}`
    case 'link':
      return `contacts.links[${target.index}]`
    case 'skill':
      return `skills[${target.index}]`
    case 'summary':
      return 'summary'
    case 'question':
      return `questions[${target.index}]`
    case 'requirement':
      return `requirements[${target.index}]`
    case 'suggestedRole':
      return `suggestedRoles[${target.index}]`
  }
}

/** One line of `submit_draft`'s answer: where, what is wrong, what to do. */
export const describeProblem = ({ target, reason }: Problem): string =>
  `${pathOf(target)}: ${reason}`

const REASONS = {
  noQuote: 'no evidence quote — add a verbatim quote from the source or drop the claim',
  shortQuote: `quote shorter than ${VERIFY_LIMITS.bulletQuote} characters — quote more of the source or drop the claim`,
  quoteNotFound: 'quote not found in source — quote verbatim or drop the claim',
  numberNotInQuote: (number: string) =>
    `number ${number} is not in the quote — use the number from the source or drop it`,
  nameNotFound: 'not found in source — copy it as written or add a verbatim quote that backs it',
  dateNotFound: (number: string) => `${number} is not in the source — copy dates as written`,
  notVerbatim: 'not in the source — copy it exactly',
  skillNotFound:
    'not found in source — keep only skills the source names, or quote the line that backs it',
  summaryNumber: (number: string) =>
    `${number} is not in the source — keep only numbers the source gives`,
  summaryToken: (token: string) =>
    `"${token}" is not backed by the source — drop it from the summary`,
  questionTarget: 'the target is not a field of the draft — fix the target or drop the question',
  requirement: 'needs a label and at least one keyword — fix it or drop it',
  suggestedRole: 'blank — write a role title or drop it',
} as const

/** How each checked field of an item is verified (backend architecture §4). */
type FieldRule = 'name' | 'numbers' | 'link'
const FIELD_RULES: Record<ItemSection, Readonly<Record<string, FieldRule>>> = {
  experience: { title: 'name', company: 'name', period: 'numbers' },
  projects: { name: 'name', period: 'numbers', url: 'link' },
  education: { institution: 'name', degree: 'name', period: 'numbers' },
  certifications: { name: 'name', issuer: 'name', year: 'numbers' },
  languages: { name: 'name', level: 'name' },
}

// a phone as people write it: digits with spaces, brackets, dots and dashes between them
const PHONE = /\+?\d[\d ().-]{5,}\d/g

const isFilled = (value: string | null): value is string => value !== null && value.trim() !== ''

/** A text field of an item by name; `null` when it is empty or not text (the bullets). */
const fieldValue = (item: Readonly<Record<string, unknown>>, field: string): string | null => {
  const value = item[field]
  return typeof value === 'string' ? value : null
}

/**
 * True when a question's target is something an answer can be written into (the shared
 * `applyAnswer`): a contact field, the summary, the skills, the whole experience block (a new
 * job), or a field of an existing item.
 */
export const targetExists = (
  cv: DraftWithoutIds,
  { section, itemIndex, field }: SubmissionTarget,
): boolean => {
  if (section === 'contacts') {
    return itemIndex === undefined && field !== undefined && Object.hasOwn(cv.contacts, field)
  }
  if (section === 'summary' || section === 'skills') {
    return itemIndex === undefined && field === undefined
  }
  if (itemIndex === undefined) return section === 'experience' && field === undefined
  const item = cv[section][itemIndex]
  return item !== undefined && field !== undefined && Object.hasOwn(item, field)
}

/**
 * Every claim of the submission that `source` and `facts` (the user's answers) don't back, by the
 * rules of backend architecture §4. Pure: `submit_draft` returns the problems to the model, and
 * `sanitise` removes what is still there after the loop. Text facts are proven by evidence quotes
 * in the source's language (ADR 0004); numbers, contacts, links and technology names directly.
 */
export const verifyDraft = (
  submission: DraftSubmission,
  source: string,
  facts: readonly PromptFact[],
): Problem[] => {
  const { cv } = submission
  const corpus = normalise([source, ...facts.map((fact) => fact.answer)].join('\n'))
  const corpusNumbers = new Set(numbersIn(corpus))
  const corpusPhones = (corpus.match(PHONE) ?? []).map(digitsOf)

  const quotes = new Map<string, string[]>()
  for (const { path, quote } of submission.evidence) {
    const key = path.replace(/\s+/g, '')
    quotes.set(key, [...(quotes.get(key) ?? []), normalise(quote)])
  }
  /** The quotes given for the target's path that are long enough and found in source or facts. */
  const backing = (target: ProblemTarget, min: number): string[] =>
    (quotes.get(pathOf(target)) ?? []).filter(
      (quote) => quote.length >= min && corpus.includes(quote),
    )

  const problems: Problem[] = []
  const report = (target: ProblemTarget, reason: string | null) => {
    if (reason !== null) problems.push({ target, reason })
  }

  const checkBullet = (bullet: string, target: ProblemTarget): string | null => {
    const all = quotes.get(pathOf(target)) ?? []
    if (all.length === 0) return REASONS.noQuote
    if (all.every((quote) => quote.length < VERIFY_LIMITS.bulletQuote)) return REASONS.shortQuote
    const found = backing(target, VERIFY_LIMITS.bulletQuote)
    if (found.length === 0) return REASONS.quoteNotFound
    const quoted = new Set(found.flatMap(numbersIn))
    const missing = numbersIn(bullet).find((number) => !quoted.has(number))
    return missing === undefined ? null : REASONS.numberNotInQuote(missing)
  }

  const checkField = (value: string, rule: FieldRule, target: ProblemTarget): string | null => {
    switch (rule) {
      case 'name':
        return corpus.includes(normalise(value)) ||
          backing(target, VERIFY_LIMITS.nameQuote).length > 0
          ? null
          : REASONS.nameNotFound
      case 'numbers': {
        const missing = numbersIn(value).find((number) => !corpusNumbers.has(number))
        return missing === undefined ? null : REASONS.dateNotFound(missing)
      }
      case 'link':
        return corpus.includes(linkKey(value)) ? null : REASONS.notVerbatim
    }
  }

  // contacts: verbatim; the full name and location are not claims the verifier checks
  const { email, phone, links } = cv.contacts
  if (isFilled(email)) {
    report(
      { kind: 'contact', field: 'email' },
      corpus.includes(normalise(email)) ? null : REASONS.notVerbatim,
    )
  }
  if (isFilled(phone)) {
    const digits = digitsOf(phone)
    const found = digits !== '' && corpusPhones.some((known) => known.includes(digits))
    report({ kind: 'contact', field: 'phone' }, found ? null : REASONS.notVerbatim)
  }
  links.forEach((link, index) => {
    if (isFilled(link))
      report({ kind: 'link', index }, corpus.includes(linkKey(link)) ? null : REASONS.notVerbatim)
  })

  for (const section of ITEM_SECTIONS) {
    cv[section].forEach((item: Readonly<Record<string, unknown>>, itemIndex) => {
      for (const [field, rule] of Object.entries(FIELD_RULES[section])) {
        const value = fieldValue(item, field)
        if (!isFilled(value)) continue
        const target: ProblemTarget = { kind: 'field', section, itemIndex, field }
        report(target, checkField(value, rule, target))
      }
    })
  }
  for (const section of BULLET_SECTIONS) {
    cv[section].forEach((item, itemIndex) => {
      item.bullets.forEach((bullet, bulletIndex) => {
        if (!isFilled(bullet)) return
        const target: ProblemTarget = { kind: 'bullet', section, itemIndex, bulletIndex }
        report(target, checkBullet(bullet, target))
      })
    })
  }

  const verifiedSkills = new Set<string>()
  cv.skills.forEach((skill, index) => {
    if (!isFilled(skill)) return
    const target: ProblemTarget = { kind: 'skill', index }
    const found =
      containsWord(corpus, normalise(skill)) || backing(target, VERIFY_LIMITS.nameQuote).length > 0
    if (found) verifiedSkills.add(normalise(skill))
    report(target, found ? null : REASONS.skillNotFound)
  })

  // the summary may only repeat verified numbers and technologies
  if (isFilled(cv.summary)) {
    const summary = normalise(cv.summary)
    for (const number of new Set(numbersIn(summary))) {
      if (!corpusNumbers.has(number))
        report({ kind: 'summary', token: number }, REASONS.summaryNumber(number))
    }
    const skillLike = skillLikeWords(cv.summary).map(normalise)
    const named = cv.skills.map(normalise).filter((skill) => containsWord(summary, skill))
    const tokens = [...new Set([...skillLike, ...named])]
      .filter((token) => !containsWord(corpus, token) && !verifiedSkills.has(token))
      .sort((a, b) => summary.indexOf(a) - summary.indexOf(b))
    for (const token of tokens) report({ kind: 'summary', token }, REASONS.summaryToken(token))
  }

  submission.questions.forEach((question, index) => {
    report(
      { kind: 'question', index },
      targetExists(cv, question.target) ? null : REASONS.questionTarget,
    )
  })
  submission.requirements.forEach(({ label, keywords }, index) => {
    const valid = isFilled(label) && keywords.some(isFilled)
    report({ kind: 'requirement', index }, valid ? null : REASONS.requirement)
  })
  // their length and count are the schema's
  submission.suggestedRoles.forEach((role, index) => {
    report({ kind: 'suggestedRole', index }, isFilled(role) ? null : REASONS.suggestedRole)
  })

  return problems
}

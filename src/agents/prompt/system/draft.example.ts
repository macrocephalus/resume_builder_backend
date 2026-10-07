import type { DraftSubmission } from '../../draft/draft-submission.schema'

/**
 * The source of the example: a made-up person whose notes are in another language than their CV,
 * so the example shows evidence quoted in the source's language (ADR 0004).
 */
export const DRAFT_EXAMPLE_SOURCE = `Jordan Example, Лісабон, jordan@example.org
Android-розробник у Sample Pay з 2021 року.
Переписав екран оплати на Jetpack Compose — падінь стало на 40% менше.
Додав оплату через Google Pay, нею користуються 2 млн людей.
2019–2021 робив мобільні застосунки на Kotlin на фрилансі.
Англійська — читаю документацію без проблем.`

/** The CV language of the example. */
export const DRAFT_EXAMPLE_LANGUAGE = 'English'

/**
 * A complete answer to `DRAFT_EXAMPLE_SOURCE` that `verifyDraft` accepts as it is (a test holds
 * it to that): the model copies its shape, so it must not teach a draft that would be rejected.
 */
export const DRAFT_EXAMPLE: DraftSubmission = {
  cv: {
    contacts: {
      fullName: 'Jordan Example',
      email: 'jordan@example.org',
      phone: null,
      location: 'Lisbon',
      links: [],
    },
    summary:
      'Android developer building payment features in Kotlin and Jetpack Compose, including a Google Pay checkout used by 2 million people.',
    experience: [
      {
        title: 'Android Developer',
        company: 'Sample Pay',
        period: '2021 – present',
        bullets: [
          'Rebuilt the checkout screen in Jetpack Compose, cutting crashes by 40%',
          'Added Google Pay checkout, now used by 2 million people',
        ],
      },
      {
        title: 'Mobile Developer',
        company: 'Freelance',
        period: '2019 – 2021',
        bullets: ['Built mobile apps in Kotlin'],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    skills: ['Kotlin', 'Jetpack Compose', 'Google Pay'],
    languages: [{ name: 'English', level: null }],
    sectionOrder: [
      'summary',
      'experience',
      'skills',
      'languages',
      'projects',
      'education',
      'certifications',
    ],
  },
  evidence: [
    { path: 'experience[0].title', quote: 'Android-розробник' },
    {
      path: 'experience[0].bullets[0]',
      quote: 'Переписав екран оплати на Jetpack Compose — падінь стало на 40% менше',
    },
    {
      path: 'experience[0].bullets[1]',
      quote: 'Додав оплату через Google Pay, нею користуються 2 млн людей',
    },
    { path: 'experience[1].title', quote: 'робив мобільні застосунки' },
    { path: 'experience[1].company', quote: 'на фрилансі' },
    { path: 'experience[1].bullets[0]', quote: 'робив мобільні застосунки на Kotlin' },
    { path: 'languages[0].name', quote: 'Англійська' },
  ],
  questions: [
    {
      kind: 'choice',
      text: 'What is your level of English?',
      label: 'English',
      options: ['B1', 'B2', 'C1', 'C2'],
      target: { section: 'languages', itemIndex: 0, field: 'level' },
    },
    {
      kind: 'text',
      text: 'How many people were on the Android team at Sample Pay, and did you lead anyone?',
      label: 'Team',
      target: { section: 'experience', itemIndex: 0, field: 'bullets' },
    },
  ],
  requirements: [
    { label: 'Kotlin', kind: 'skill', keywords: ['kotlin'] },
    { label: 'Leading a mobile team', kind: 'experience', keywords: ['team lead', 'mentoring'] },
  ],
  suggestedRoles: ['Mobile Developer'],
}

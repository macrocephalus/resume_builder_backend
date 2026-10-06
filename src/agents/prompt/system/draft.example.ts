import type { DraftSubmission } from '../../draft/draft-submission.schema'

/**
 * One static submission that shows the shape of an answer. Its person is made up and its source
 * is not in the prompt: the model must not reuse any of its content.
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
      'Mobile developer with five years of Kotlin, building payment screens used by 2 million people.',
    experience: [
      {
        title: 'Android Developer',
        company: 'Sample Pay',
        period: '2021 – present',
        bullets: ['Rebuilt the checkout screen in Jetpack Compose, cutting crashes by 40%'],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    skills: ['Kotlin', 'Jetpack Compose'],
    languages: [{ name: 'English', level: null }],
    sectionOrder: [
      'summary',
      'experience',
      'skills',
      'projects',
      'education',
      'certifications',
      'languages',
    ],
  },
  evidence: [
    { path: 'experience[0].company', quote: 'Android dev at Sample Pay since 2021' },
    {
      path: 'experience[0].bullets[0]',
      quote: 'rewrote checkout in Compose, crashes went down 40%',
    },
    { path: 'skills[0]', quote: 'Kotlin' },
  ],
  questions: [
    {
      kind: 'choice',
      text: 'What is your level of English?',
      label: 'English',
      options: ['B1', 'B2', 'C1', 'C2'],
      target: { section: 'languages', itemIndex: 0, field: 'level' },
    },
  ],
  requirements: [
    { label: 'Kotlin', kind: 'skill', keywords: ['kotlin'] },
    { label: 'Leading a mobile team', kind: 'experience', keywords: ['team lead', 'mentoring'] },
  ],
  suggestedRoles: ['Mobile Developer'],
}

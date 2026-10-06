import { describe, expect, it } from 'vitest'
import type { DraftSubmission } from '../draft/draft-submission.schema'
import { describeProblem, verifyDraft } from './verify-draft'

const SOURCE = [
  'Olena Hnatiuk, olena@example.com, +380 67 123 45 67, github.com/olena',
  'Backend engineer at Fintory, 2019 – 2024.',
  'Moved card authorisations to an outbox pattern, 1,200 payments a second.',
  'Skills: Node.js, PostgreSQL, Kafka. English B2.',
].join('\n')

// the same person, written in Ukrainian
const UK_SOURCE = [
  'Олена Гнатюк, olena@example.com',
  'Бекенд-інженерка у Fintory, 2019 – 2024.',
  'Перевела авторизації карток на патерн outbox, 1 200 платежів на секунду.',
  'Навички: Node.js, PostgreSQL. Англійська — вище середнього.',
].join('\n')

const ORDER: DraftSubmission['cv']['sectionOrder'] = [
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
  'languages',
]

/** A draft that the source backs in full. */
const draft = (): DraftSubmission => ({
  cv: {
    contacts: {
      fullName: 'Olena Hnatiuk',
      email: 'olena@example.com',
      phone: '+380671234567',
      location: null,
      links: ['https://github.com/olena'],
    },
    summary: 'Backend engineer moving 1,200 payments a second with Node.js and Kafka.',
    experience: [
      {
        title: 'Backend Engineer',
        company: 'Fintory',
        period: '2019 – 2024',
        bullets: ['Moved card authorisations to an outbox pattern at 1,200 payments per second'],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    skills: ['Node.js', 'PostgreSQL', 'Kafka'],
    languages: [{ name: 'English', level: 'B2' }],
    sectionOrder: ORDER,
  },
  evidence: [
    {
      path: 'experience[0].bullets[0]',
      quote: 'Moved card authorisations to an outbox pattern, 1,200 payments a second',
    },
  ],
  questions: [],
  requirements: [{ label: 'Kafka', kind: 'skill', keywords: ['kafka'] }],
  suggestedRoles: ['Payments Engineer'],
})

/** The first entry of a list the test just built; fails the test when it is missing. */
const first = <T>(list: readonly T[]): T => {
  const [item] = list
  if (item === undefined) throw new Error('empty list')
  return item
}

const lines = (
  submission: DraftSubmission,
  source = SOURCE,
  facts: { question: string; answer: string }[] = [],
) => verifyDraft(submission, source, facts).map(describeProblem)

describe('verifyDraft', () => {
  it('accepts a draft the source backs', () => {
    expect(lines(draft())).toEqual([])
  })

  it('rejects an invented bullet: no quote, a quote not in the source, a quote too short', () => {
    const submission = draft()
    first(submission.cv.experience).bullets.push(
      'Led a team of 12 engineers',
      'Cut costs',
      'Mentored juniors',
    )
    submission.evidence.push(
      { path: 'experience[0].bullets[2]', quote: 'Cut costs by half in 2023' },
      { path: 'experience[0].bullets[3]', quote: 'mentor' },
    )
    expect(lines(submission)).toEqual([
      'experience[0].bullets[1]: no evidence quote — add a verbatim quote from the source or drop the claim',
      'experience[0].bullets[2]: quote not found in source — quote verbatim or drop the claim',
      'experience[0].bullets[3]: quote shorter than 8 characters — quote more of the source or drop the claim',
    ])
  })

  it('rejects a bullet with a number its quote does not have', () => {
    const submission = draft()
    first(submission.cv.experience).bullets[0] =
      'Moved card authorisations to an outbox pattern at 2,000 payments per second'
    expect(lines(submission)).toEqual([
      'experience[0].bullets[0]: number 2000 is not in the quote — use the number from the source or drop it',
    ])
  })

  it('finds a quote in the facts the user gave', () => {
    const submission = draft()
    submission.cv.projects.push({
      name: null,
      period: null,
      url: null,
      bullets: ['Ran a Go meetup of 40 people'],
    })
    submission.evidence.push({
      path: 'projects[0].bullets[0]',
      quote: 'I ran a Go meetup, 40 people came',
    })
    expect(
      lines(submission, SOURCE, [
        { question: 'Any side projects?', answer: 'I ran a Go meetup, 40 people came' },
      ]),
    ).toEqual([])
    expect(lines(submission)).toEqual([
      'projects[0].bullets[0]: quote not found in source — quote verbatim or drop the claim',
    ])
  })

  it('rejects a wrong year, an unknown company and an invented language level', () => {
    const submission = draft()
    const job = first(submission.cv.experience)
    job.period = '2017 – 2024'
    job.company = 'Monobank'
    first(submission.cv.languages).level = 'C1'
    expect(lines(submission)).toEqual([
      'experience[0].company: not found in source — copy it as written or add a verbatim quote that backs it',
      'experience[0].period: 2017 is not in the source — copy dates as written',
      'languages[0].level: not found in source — copy it as written or add a verbatim quote that backs it',
    ])
  })

  it('checks contacts verbatim, the phone by its digits and links without the scheme', () => {
    const submission = draft()
    submission.cv.contacts.phone = '+38 (067) 123-45-67'
    expect(lines(submission)).toEqual([])
    submission.cv.contacts = {
      ...submission.cv.contacts,
      email: 'olena.h@example.com',
      phone: '+380 50 000 00 00',
      links: ['https://github.com/olena', 'https://linkedin.com/in/olena'],
    }
    expect(lines(submission)).toEqual([
      'contacts.email: not in the source — copy it exactly',
      'contacts.phone: not in the source — copy it exactly',
      'contacts.links[1]: not in the source — copy it exactly',
    ])
  })

  it('rejects a skill the source does not name, unless a quote backs it', () => {
    const submission = draft()
    submission.cv.skills.push('Kubernetes', 'Java', 'Event-driven design')
    submission.evidence.push(
      // a syllable of the source backs nothing
      { path: 'skills[3]', quote: 'Kaf' },
      { path: 'skills[5]', quote: 'outbox pattern' },
    )
    expect(lines(submission)).toEqual([
      'skills[3]: not found in source — keep only skills the source names, or quote the line that backs it',
      'skills[4]: not found in source — keep only skills the source names, or quote the line that backs it',
    ])
  })

  it('rejects a summary with a number or a technology that is not verified', () => {
    const submission = draft()
    submission.cv.skills.push('Kubernetes')
    submission.cv.summary =
      'Backend engineer with 10 years of experience. Runs Kubernetes and AWS. Builds payments with Node.js, speaks English at B2.'
    expect(lines(submission).filter((line) => line.startsWith('summary'))).toEqual([
      'summary: 10 is not in the source — keep only numbers the source gives',
      'summary: "kubernetes" is not backed by the source — drop it from the summary',
      'summary: "aws" is not backed by the source — drop it from the summary',
    ])
  })

  it('rejects a question whose target is not a field of the draft', () => {
    const submission = draft()
    const ask = (target: DraftSubmission['questions'][number]['target']) => ({
      kind: 'text' as const,
      text: 'Q?',
      label: 'L',
      target,
    })
    submission.questions = [
      ask({ section: 'languages', itemIndex: 0, field: 'level' }),
      ask({ section: 'experience' }),
      ask({ section: 'contacts', field: 'phone' }),
      ask({ section: 'experience', itemIndex: 3, field: 'period' }),
      ask({ section: 'languages', itemIndex: 0, field: 'fluency' }),
      ask({ section: 'certifications' }),
      ask({ section: 'summary', itemIndex: 0 }),
    ]
    expect(lines(submission)).toEqual(
      [3, 4, 5, 6].map(
        (index) =>
          `questions[${index}]: the target is not a field of the draft — fix the target or drop the question`,
      ),
    )
  })

  it('rejects requirements without a keyword and blank suggested roles', () => {
    const submission = draft()
    submission.requirements.push({ label: 'Cloud', kind: 'skill', keywords: [' '] })
    submission.suggestedRoles = ['Payments Engineer', ' ', 'Tech Lead']
    expect(lines(submission)).toEqual([
      'requirements[1]: needs a label and at least one keyword — fix it or drop it',
      'suggestedRoles[1]: blank — write a role title or drop it',
    ])
  })

  describe('a Ukrainian source and an English CV', () => {
    const english = (): DraftSubmission => {
      const submission = draft()
      submission.cv.contacts = {
        ...submission.cv.contacts,
        fullName: 'Olena Hnatiuk',
        phone: null,
        links: [],
      }
      submission.cv.summary = 'Backend engineer moving 1,200 payments a second with Node.js.'
      submission.cv.skills = ['Node.js', 'PostgreSQL']
      submission.cv.languages = [{ name: 'English', level: 'Upper-Intermediate' }]
      submission.evidence = [
        { path: 'experience[0].title', quote: 'Бекенд-інженерка' },
        {
          path: 'experience[0].bullets[0]',
          quote: 'Перевела авторизації карток на патерн outbox, 1 200 платежів на секунду',
        },
        { path: 'languages[0].name', quote: 'Англійська' },
        { path: 'languages[0].level', quote: 'вище середнього' },
      ]
      return submission
    }

    it('passes with Ukrainian quotes and the numbers intact', () => {
      expect(lines(english(), UK_SOURCE)).toEqual([])
    })

    it('fails when a quote is paraphrased or a number changed', () => {
      const submission = english()
      submission.evidence = submission.evidence.map((entry) =>
        entry.path === 'experience[0].bullets[0]'
          ? { ...entry, quote: 'перевела авторизації на outbox, 1 200 платежів за секунду' }
          : entry.path === 'experience[0].title'
            ? { ...entry, quote: 'Бекенд-інженер' }
            : entry,
      )
      expect(lines(submission, UK_SOURCE)).toEqual([
        'experience[0].bullets[0]: quote not found in source — quote verbatim or drop the claim',
      ])
      // "Бекенд-інженер" is a substring of "Бекенд-інженерка": a quote, not a translation check
      const changed = english()
      first(changed.cv.experience).bullets[0] =
        'Moved card authorisations to an outbox pattern at 1,500 payments a second'
      expect(lines(changed, UK_SOURCE)).toEqual([
        'experience[0].bullets[0]: number 1500 is not in the quote — use the number from the source or drop it',
      ])
    })
  })
})

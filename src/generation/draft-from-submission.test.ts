import { cvDataSchema } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import { completeSubmission } from '../../test/helpers/model'
import type { DraftSubmission } from '../agents/draft/draft-submission.schema'
import { draftFromSubmission } from './draft-from-submission'

const sequentialIds = () => {
  let next = 0
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

const withQuestions = (questions: DraftSubmission['questions']): DraftSubmission => ({
  ...completeSubmission(),
  questions,
})

describe('draftFromSubmission', () => {
  it('gives every item a UUID and returns a valid CvData', () => {
    const { data } = draftFromSubmission(completeSubmission(), sequentialIds())
    expect(data.experience[0]?.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(data.languages[0]?.id).toBe('00000000-0000-4000-8000-000000000002')
    expect(cvDataSchema.safeParse(data).success).toBe(true)
  })

  it('maps a question target from the item index to the item id', () => {
    const { questions } = draftFromSubmission(
      withQuestions([
        {
          kind: 'choice',
          text: 'Your English level?',
          label: 'English',
          options: ['B2', 'C1'],
          target: { section: 'languages', itemIndex: 0, field: 'level' },
        },
        {
          kind: 'text',
          text: 'Any certificates?',
          label: 'Certificates',
          target: { section: 'certifications' },
        },
      ]),
      sequentialIds(),
    )
    expect(questions).toEqual([
      {
        kind: 'choice',
        origin: 'model',
        text: 'Your English level?',
        label: 'English',
        options: ['B2', 'C1'],
        claim: null,
        target: {
          section: 'languages',
          itemId: '00000000-0000-4000-8000-000000000002',
          field: 'level',
        },
      },
      {
        kind: 'text',
        origin: 'model',
        text: 'Any certificates?',
        label: 'Certificates',
        options: [],
        claim: null,
        target: { section: 'certifications' },
      },
    ])
  })

  it('drops a question whose target points nowhere', () => {
    const ask = (target: DraftSubmission['questions'][number]['target']) => ({
      kind: 'text' as const,
      text: 'When?',
      label: 'Period',
      target,
    })
    const { questions } = draftFromSubmission(
      withQuestions([
        ask({ section: 'experience', itemIndex: 5, field: 'period' }),
        ask({ section: 'summary', itemIndex: 0 }),
      ]),
      sequentialIds(),
    )
    expect(questions).toEqual([])
  })

  it('drops empty items, blank bullets and skills, and questions about a dropped item', () => {
    const submission = completeSubmission()
    submission.cv.experience.push({ title: null, company: ' ', period: null, bullets: ['', '  '] })
    submission.cv.skills.push(' ')
    submission.questions = [
      {
        kind: 'text',
        text: 'Which company?',
        label: 'Company',
        target: { section: 'experience', itemIndex: 1 },
      },
    ]
    const { data, questions } = draftFromSubmission(submission, sequentialIds())
    expect(data.experience).toHaveLength(1)
    expect(data.skills).toEqual(['Node.js', 'PostgreSQL'])
    expect(questions).toEqual([])
  })

  it('tells the id an item got, and nothing for an item dropped as empty', () => {
    const submission = completeSubmission()
    submission.cv.experience.push({ title: null, company: null, period: null, bullets: [] })
    const { data, itemIdOf } = draftFromSubmission(submission, sequentialIds())
    expect(itemIdOf('experience', 0)).toBe(data.experience[0]?.id)
    expect(itemIdOf('experience', 1)).toBeUndefined()
    expect(itemIdOf('projects', 0)).toBeUndefined()
  })

  it('turns a choice without two options into a text question', () => {
    const { questions } = draftFromSubmission(
      withQuestions([
        {
          kind: 'choice',
          text: 'Level?',
          label: 'Level',
          options: ['B2'],
          target: { section: 'languages' },
        },
      ]),
      sequentialIds(),
    )
    expect(questions[0]).toMatchObject({ kind: 'text', options: [] })
  })
})

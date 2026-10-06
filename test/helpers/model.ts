import { MockLanguageModelV4 } from 'ai/test'
import type { DraftSubmission } from '../../src/agents/draft/draft-submission.schema'

/** What a language model answers for one step (`@ai-sdk/provider`'s `LanguageModelV4GenerateResult`). */
type LanguageModelV4GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>

const usage = (input: number, cacheRead = 0): LanguageModelV4GenerateResult['usage'] => ({
  inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 },
  outputTokens: { total: 200, text: 150, reasoning: 50 },
})

/** A model step that calls `submit_draft` with `input` (any JSON, valid or not). */
export const submitStep = (input: unknown, cacheRead = 0): LanguageModelV4GenerateResult => ({
  content: [
    {
      type: 'tool-call',
      toolCallId: `call-${Math.random().toString(36).slice(2)}`,
      toolName: 'submit_draft',
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
  usage: usage(1000, cacheRead),
  warnings: [],
})

/** A model step that answers in text instead of calling the tool. */
export const textStep = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'end_turn' },
  usage: usage(1000),
  warnings: [],
})

/** A model that answers each step with the next scripted result. */
export const scriptedModel = (...steps: LanguageModelV4GenerateResult[]): MockLanguageModelV4 =>
  new MockLanguageModelV4({ provider: 'test', modelId: 'scripted', doGenerate: steps })

const SECTION_ORDER: DraftSubmission['cv']['sectionOrder'] = [
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
  'languages',
]

/** A submission with every required part filled in: it saves as a `ready` CV. */
export const completeSubmission = (): DraftSubmission => ({
  cv: {
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
        title: 'Backend Engineer',
        company: 'Fintory',
        period: '2019 – present',
        bullets: ['Moved card authorisations to an outbox pattern', 'Built the payments API'],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    skills: ['Node.js', 'PostgreSQL'],
    languages: [{ name: 'English', level: null }],
    sectionOrder: SECTION_ORDER,
  },
  evidence: [{ path: 'experience[0].company', quote: 'Fintory' }],
  questions: [],
  requirements: [
    { label: 'Node.js', kind: 'skill', keywords: ['node.js'] },
    { label: 'Kubernetes', kind: 'skill', keywords: ['kubernetes'] },
  ],
  suggestedRoles: ['Node.js Tech Lead'],
})

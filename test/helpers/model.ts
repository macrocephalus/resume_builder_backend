import { APICallError } from 'ai'
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

/**
 * The Anthropic API failing with `statusCode`. `retry-after-ms: 0` lets the SDK's own retries of
 * the call (2 more) go without waiting, so one retryable status fails an attempt after 3 calls.
 */
export const apiError = (statusCode: number): APICallError =>
  new APICallError({
    message: `Anthropic answered ${statusCode}`,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    responseHeaders: { 'retry-after-ms': '0' },
  })

/** A model whose calls, in order, answer the next scripted result or throw the next error. */
export const scriptedModel = (
  ...calls: Array<LanguageModelV4GenerateResult | Error>
): MockLanguageModelV4 => {
  let next = 0
  return new MockLanguageModelV4({
    provider: 'test',
    modelId: 'scripted',
    doGenerate: async () => {
      const call = calls[next++]
      if (call === undefined)
        throw new Error(`the model was called ${next} times, scripted for ${calls.length}`)
      if (call instanceof Error) throw call
      return call
    },
  })
}

/** A model that never answers, like a hung connection, until the call is aborted. */
export const hangingModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    provider: 'test',
    modelId: 'hanging',
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = abortSignal.reason
            reject(reason instanceof Error ? reason : new Error('aborted'))
          },
          { once: true },
        )
      }),
  })

const SECTION_ORDER: DraftSubmission['cv']['sectionOrder'] = [
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
  'languages',
]

/** A source over the 80-character minimum that backs every claim of `completeSubmission`. */
export const SOURCE_TEXT = [
  'Olena Hnatiuk, olena@example.com, Kyiv.',
  'Backend engineer at Fintory since 2019. Eight years of Node.js and PostgreSQL in payments.',
  'Moved card authorisations to an outbox pattern. Built the payments API. English.',
].join('\n')

/**
 * A submission with every required part filled in, each claim backed by `SOURCE_TEXT`: it is
 * accepted on the first step and saves as a `ready` CV.
 */
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
  evidence: [
    { path: 'experience[0].bullets[0]', quote: 'Moved card authorisations to an outbox pattern' },
    { path: 'experience[0].bullets[1]', quote: 'Built the payments API' },
  ],
  questions: [],
  requirements: [
    { label: 'Node.js', kind: 'skill', keywords: ['node.js'] },
    { label: 'Kubernetes in production', kind: 'experience', keywords: ['kubernetes'] },
  ],
  suggestedRoles: ['Node.js Tech Lead'],
})

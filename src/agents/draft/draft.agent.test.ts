import type { GenerationStage } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import {
  SOURCE_TEXT,
  completeSubmission,
  scriptedModel,
  submitStep,
  textStep,
} from '../../../test/helpers/model'
import type { PromptInput } from '../prompt/prompt-builder'
import type { DraftSubmission } from './draft-submission.schema'
import { DRAFT_AGENT_LIMITS, type DraftStep, runDraftAgent } from './draft.agent'

const input: PromptInput = {
  source: SOURCE_TEXT,
  facts: [],
  targetRole: 'Senior Backend Engineer',
  roleContext: null,
  language: 'en',
  today: new Date('2026-10-06T00:00:00Z'),
}

/** `completeSubmission` with a bullet the source doesn't back. */
const withInventedBullet = (bullet = 'Led a team of 12 engineers'): DraftSubmission => {
  const submission = completeSubmission()
  submission.cv.experience[0]?.bullets.push(bullet)
  return submission
}

const run = async (...steps: Parameters<typeof scriptedModel>) => {
  const stages: GenerationStage[] = []
  const model = scriptedModel(...steps)
  const onStage = async (stage: GenerationStage) => {
    stages.push(stage)
  }
  const result = await runDraftAgent(model, input, { onStage }, DRAFT_AGENT_LIMITS)
  return { result, stages, model }
}

describe('runDraftAgent', () => {
  it('ends on the first accepted submission and returns it with the usage', async () => {
    const { result, stages, model } = await run(submitStep(completeSubmission(), 400))
    expect(result.submission).toEqual(completeSubmission())
    expect(result.steps).toBe(1)
    expect(result.usage.inputTokens).toBe(1000)
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(400)
    expect(stages).toEqual(['drafting', 'verifying'])
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('sends the instructions as the system message and the data as the user message, both cache breakpoints', async () => {
    const { model } = await run(submitStep(completeSubmission()))
    const [call] = model.doGenerateCalls
    const [system, user] = call?.prompt ?? []
    expect(system).toMatchObject({
      role: 'system',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(user).toMatchObject({
      role: 'user',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(JSON.stringify(user)).toContain('<source>')
    expect(JSON.stringify(system)).not.toContain('Olena')
    expect(call?.toolChoice).toEqual({ type: 'auto' })
    expect(call?.providerOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
  })

  it('gives an invalid input back to the model and takes the valid submission of a later step', async () => {
    const { result, model } = await run(
      submitStep({ cv: 'not a draft' }),
      submitStep(completeSubmission()),
    )
    expect(model.doGenerateCalls).toHaveLength(2)
    // the second request carries the first call's error as its tool result
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('tool-result')
    expect(result.submission).toEqual(completeSubmission())
    expect(result.steps).toBe(2)
  })

  it('returns the problems to the model, and ends when the revised draft is accepted', async () => {
    const invented = withInventedBullet()
    const { result, stages, model } = await run(
      submitStep(invented),
      submitStep(completeSubmission()),
    )
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain(
      'experience[0].bullets[2]: no evidence quote — add a verbatim quote from the source or drop the claim',
    )
    expect(stages).toEqual(['drafting', 'verifying', 'revising', 'verifying'])
    expect(result.submission).toEqual(completeSubmission())
    expect(result.steps).toBe(2)
  })

  it('stops after three rejected drafts and returns the last one', async () => {
    const { result, model } = await run(
      submitStep(withInventedBullet()),
      submitStep(withInventedBullet()),
      submitStep(withInventedBullet('Cut costs by 30%')),
      submitStep(completeSubmission()),
    )
    expect(model.doGenerateCalls).toHaveLength(3)
    expect(result.submission?.cv.experience[0]?.bullets.at(-1)).toBe('Cut costs by 30%')
  })

  it('tells the caller the prompt and each step: input, verdict, usage', async () => {
    const prompts: string[] = []
    const steps: DraftStep[] = []
    const invented = withInventedBullet()
    await runDraftAgent(
      scriptedModel(
        submitStep({ cv: 'not a draft' }),
        submitStep(invented),
        submitStep(completeSubmission()),
      ),
      input,
      {
        onStage: async () => {},
        onPrompt: (message) => prompts.push(message),
        onStep: (step) => steps.push(step),
      },
      DRAFT_AGENT_LIMITS,
    )
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(SOURCE_TEXT.split('\n')[0])
    expect(steps.map((step) => [step.number, step.finishReason])).toEqual([
      [1, 'tool-calls'],
      [2, 'tool-calls'],
      [3, 'tool-calls'],
    ])
    expect(steps[0]).toMatchObject({ input: { cv: 'not a draft' }, result: null })
    expect(steps[0]?.toolError).toEqual(expect.any(String))
    expect(steps[1]).toMatchObject({
      input: invented,
      result: { accepted: false },
      toolError: null,
    })
    expect(steps[2]).toMatchObject({ result: { accepted: true } })
    expect(steps[2]?.usage.inputTokens).toBe(1000)
  })

  it('has no submission when the model answers in text', async () => {
    const { result } = await run(textStep('Here is your CV: ...'))
    expect(result.submission).toBeNull()
    expect(result.steps).toBe(1)
  })

  it('stops after three steps of invalid input', async () => {
    const { result, model } = await run(
      submitStep({ cv: 1 }),
      submitStep({ cv: 2 }),
      submitStep({ cv: 3 }),
      submitStep(completeSubmission()),
    )
    expect(model.doGenerateCalls).toHaveLength(3)
    expect(result.submission).toBeNull()
  })
})

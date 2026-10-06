import type { GenerationStage } from '@cv/shared'
import { describe, expect, it } from 'vitest'
import {
  completeSubmission,
  scriptedModel,
  submitStep,
  textStep,
} from '../../../test/helpers/model'
import type { PromptInput } from '../prompt/prompt-builder'
import { runDraftAgent } from './draft.agent'

const input: PromptInput = {
  source: 'Olena Hnatiuk, backend engineer at Fintory since 2019.',
  facts: [],
  targetRole: 'Senior Backend Engineer',
  roleContext: null,
  language: 'en',
  today: new Date('2026-10-06T00:00:00Z'),
}

const run = async (...steps: Parameters<typeof scriptedModel>) => {
  const stages: GenerationStage[] = []
  const model = scriptedModel(...steps)
  const result = await runDraftAgent(model, input, async (stage) => {
    stages.push(stage)
  })
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

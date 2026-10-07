import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

/**
 * Injection token for the `LanguageModel` the agents run on. The worker binds it to Anthropic;
 * tests bind it to a scripted `MockLanguageModelV4`. There is no runtime switch to a fake model.
 */
export const LANGUAGE_MODEL = Symbol('LANGUAGE_MODEL')

/**
 * Injection token for the fast `LanguageModel` that words answers in the api. Bound like
 * `LANGUAGE_MODEL`: Anthropic in the app, a scripted model in the tests.
 */
export const FAST_LANGUAGE_MODEL = Symbol('FAST_LANGUAGE_MODEL')

export const createLanguageModel = ({
  apiKey,
  modelId,
}: {
  apiKey: string
  modelId: string
}): LanguageModel => createAnthropic({ apiKey })(modelId)

/** The model's id as stored on an attempt row. */
export const modelIdOf = (model: LanguageModel): string =>
  typeof model === 'string' ? model : model.modelId

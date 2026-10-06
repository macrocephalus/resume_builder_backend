/** Why a generation failed, as stored in `cvs.error_code`, with the text the user sees. */
export const GENERATION_ERRORS = {
  LLM_UNAVAILABLE: 'The AI service is unavailable right now. Try again in a few minutes.',
  LLM_INVALID_OUTPUT: 'The AI returned an unusable draft several times. Try again.',
  LLM_CONFIG: 'The AI service is not configured on the server.',
  TIMEOUT: 'Generation took too long. Try again.',
  INTERNAL: 'Something went wrong on our side. Try again.',
} as const satisfies Record<string, string>

export type GenerationErrorCode = keyof typeof GENERATION_ERRORS

/** The columns a failed CV is written with (docs/cv-statuses.md, `failed`). */
export const failure = (code: GenerationErrorCode) => ({
  errorCode: code,
  error: GENERATION_ERRORS[code],
  stage: null,
})

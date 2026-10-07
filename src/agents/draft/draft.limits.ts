/** The bounds of one attempt (backend architecture §3); the prompt tells the model the steps. */
export const DRAFT_AGENT_LIMITS = {
  steps: 3,
  stepMs: 120_000,
  totalMs: 300_000,
  /** Retries of one step by the SDK (a short 529 on step 2 keeps step 1). */
  maxRetries: 2,
  maxOutputTokens: 16_000,
} as const

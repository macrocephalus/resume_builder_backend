import { GENERATION } from '../config/limits'

/** Injection token for the limits on starting a generation (`GenerationLimits`). */
export const GENERATION_LIMITS = Symbol('GENERATION_LIMITS')

/**
 * What a user may start: `perHour` in any sliding `windowMs`, and `activePerUser` at once. Tests
 * bind smaller ones.
 */
export type GenerationLimits = { perHour: number; windowMs: number; activePerUser: number }

export const GENERATION_LIMITS_DEFAULTS: GenerationLimits = {
  perHour: GENERATION.perHour,
  windowMs: GENERATION.windowMs,
  activePerUser: GENERATION.activePerUser,
}

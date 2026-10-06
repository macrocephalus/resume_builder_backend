import { type ExecutionContext, Injectable, UseGuards, applyDecorators } from '@nestjs/common'
import {
  Throttle,
  ThrottlerGuard,
  type ThrottlerGetTrackerFunction,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler'
import { AppError } from '../errors/app-error'

/**
 * `@nestjs/throttler`'s guard answering in the api's error shape. The throttler has already set
 * `Retry-After` (seconds) when this is called.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    { limit }: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.', {
      limit,
    })
  }
}

/**
 * Counts per signed-in user: the id the global auth guard put on the request
 * (`AuthenticatedRequest.userId`) before this guard runs. The throttler types the request loosely,
 * so the field is checked rather than trusted.
 */
const perUser: ThrottlerGetTrackerFunction = (req) => {
  const userId: unknown = req.userId
  if (typeof userId !== 'string') {
    throw new Error('A per-user rate limit on a route the auth guard did not check')
  }
  return `user:${userId}`
}

/**
 * Limits a route to `limit` requests per `ttlMs` → `429 RATE_LIMITED`, counted per client IP
 * (public routes) or per signed-in user.
 */
export const RateLimit = (
  { limit, ttlMs }: { limit: number; ttlMs: number },
  per: 'ip' | 'user' = 'ip',
) =>
  applyDecorators(
    Throttle({
      default: { limit, ttl: ttlMs, ...(per === 'user' ? { getTracker: perUser } : {}) },
    }),
    UseGuards(RateLimitGuard),
  )

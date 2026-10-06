import { type ExecutionContext, Injectable, UseGuards, applyDecorators } from '@nestjs/common'
import { Throttle, ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler'
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
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.', {
      limit,
    })
  }
}

/** Limits a route to `limit` requests per `ttlMs` per client IP → `429 RATE_LIMITED`. */
export const RateLimit = ({ limit, ttlMs }: { limit: number; ttlMs: number }) =>
  applyDecorators(Throttle({ default: { limit, ttl: ttlMs } }), UseGuards(RateLimitGuard))

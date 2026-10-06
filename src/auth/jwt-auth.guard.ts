import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import type { AuthenticatedRequest } from '../common/auth/current-user.decorator'
import { IS_PUBLIC } from '../common/auth/public.decorator'
import { notSignedIn } from './auth-errors'
import { SESSION_COOKIE } from './session-cookie'
import { SessionService } from './session.service'

/**
 * Global (`APP_GUARD`): every route needs a session cookie with a verified token unless it is
 * `@Public()`. Puts the user id on the request for `@CurrentUser()` and on every log line.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token: unknown = request.cookies[SESSION_COOKIE]
    const userId = typeof token === 'string' ? await this.sessions.verify(token) : null
    if (userId === null) throw notSignedIn()

    request.userId = userId
    this.logger.assign({ userId })
    return true
  }
}

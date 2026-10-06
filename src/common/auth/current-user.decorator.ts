import { type ExecutionContext, createParamDecorator } from '@nestjs/common'
import type { Request } from 'express'

/** A request the auth guard let through: `userId` comes from the verified session token. */
export type AuthenticatedRequest = Request & { userId?: string }

/**
 * The signed-in user's id, as the auth guard verified it. The only source of a user id in a
 * handler: an id in a body, query or path never stands for the caller.
 *
 *   @Get() list(@CurrentUser() userId: string)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const { userId } = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (userId === undefined) {
      throw new Error('@CurrentUser() on a route the auth guard did not check: is it @Public()?')
    }
    return userId
  },
)

import { type Credentials, type User, credentialsSchema, userResponseSchema } from '@cv/shared'
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { Public } from '../common/auth/public.decorator'
import { RateLimit } from '../common/http/rate-limit'
import { ZodValidationPipe } from '../common/http/zod-validation.pipe'
import { ApiErrors, ApiSession, ApiZodBody } from '../common/openapi/api-docs.decorators'
import { THROTTLES } from '../config/limits'
import { AuthService, type Session } from './auth.service'
import { clearSessionCookie, setSessionCookie } from './session-cookie'

type UserResponse = { user: User }

/** Sets the session cookie; the body carries only the user, never the token. */
const startSession = (req: Request, res: Response, { user, token }: Session): UserResponse => {
  setSessionCookie(req, res, token)
  return { user }
}

const credentialsPipe = new ZodValidationPipe(credentialsSchema)

/** Signup, login, logout, me (docs/api.md "Auth"). The session is a JWT in an httpOnly cookie. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiZodBody(credentialsSchema)
  @ApiCreatedResponse({
    description: 'Sets the session cookie',
    standardSchema: userResponseSchema,
  })
  @ApiErrors('VALIDATION_ERROR', 'EMAIL_TAKEN')
  async signup(
    @Body(credentialsPipe) body: Credentials,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    return startSession(req, res, await this.auth.signup(body))
  }

  @Public()
  @RateLimit(THROTTLES.login)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in and start a session' })
  @ApiZodBody(credentialsSchema)
  @ApiOkResponse({ description: 'Sets the session cookie', standardSchema: userResponseSchema })
  @ApiErrors('VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'RATE_LIMITED')
  async login(
    @Body(credentialsPipe) body: Credentials,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    return startSession(req, res, await this.auth.login(body))
  }

  /** Always `204`: with an expired, broken or no cookie too. The token itself is not revoked. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session' })
  @ApiNoContentResponse({ description: 'Clears the session cookie, with or without a session' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    clearSessionCookie(req, res)
  }

  @Get('me')
  @ApiSession()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkResponse({ standardSchema: userResponseSchema })
  async me(@CurrentUser() userId: string): Promise<UserResponse> {
    return { user: await this.auth.me(userId) }
  }
}

import { Injectable } from '@nestjs/common'
import { JsonWebTokenError, JwtService } from '@nestjs/jwt'
import { z } from 'zod'
import { JwtSecretService } from './jwt-secret.service'

const payloadSchema = z.object({ sub: z.uuid() })

/** Issues and verifies session tokens: a JWT `{ sub: userId }`, HS256, 7 days (`JwtModule`). */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly secret: JwtSecretService,
  ) {}

  issue(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId }, { secret: this.secret.get() })
  }

  /**
   * The user id of a token whose signature and expiry check out, else `null`. Verified, never
   * just decoded: a token signed with another key, unsigned (`alg: none`) or expired is `null`.
   */
  async verify(token: string): Promise<string | null> {
    let payload: unknown
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.secret.get() })
    } catch (error) {
      // bad signature, malformed, expired, not yet valid: all mean "not signed in"
      if (error instanceof JsonWebTokenError) return null
      throw error
    }
    const parsed = payloadSchema.safeParse(payload)
    return parsed.success ? parsed.data.sub : null
  }
}

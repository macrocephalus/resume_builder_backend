import { randomBytes } from 'node:crypto'
import type { Credentials, User } from '@cv/shared'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { AppError } from '../common/errors/app-error'
import { DATABASE, type Database } from '../database/database.module'
import { users } from '../database/schema'
import { invalidCredentials, notSignedIn } from './auth-errors'
import { hashPassword, verifyPassword } from './password'
import { SessionService } from './session.service'

/** A signed-in user and the token for their session cookie. */
export type Session = { user: User; token: string }

@Injectable()
export class AuthService implements OnModuleInit {
  /** Verified against when the email is unknown, so both failures take the same time. */
  private dummyHash = ''

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('base64url'))
  }

  /** `409 EMAIL_TAKEN` when the (already lower-cased) email has an account. */
  async signup({ email, password }: Credentials): Promise<Session> {
    const passwordHash = await hashPassword(password)
    const [user] = await this.db
      .insert(users)
      .values({ email, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email })
    if (!user) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.')
    return this.startSession(user)
  }

  /** One `401 INVALID_CREDENTIALS`, same body and cost, for an unknown email and a wrong password. */
  async login({ email, password }: Credentials): Promise<Session> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email))
    const valid = await verifyPassword(row?.passwordHash ?? this.dummyHash, password)
    if (!row || !valid) throw invalidCredentials()
    return this.startSession({ id: row.id, email: row.email })
  }

  /** The signed-in user; `401` when their account is gone although the token is still valid. */
  async me(userId: string): Promise<User> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
    if (!user) throw notSignedIn()
    return user
  }

  private async startSession(user: User): Promise<Session> {
    return { user, token: await this.sessions.issue(user.id) }
  }
}

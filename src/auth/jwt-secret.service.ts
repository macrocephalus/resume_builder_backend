import { randomBytes } from 'node:crypto'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { DATABASE, type Database } from '../database/database.module'
import { appSecrets } from '../database/schema'

const SECRET_NAME = 'jwt'

/**
 * The key sessions are signed with. `JWT_SECRET` from the env when set; otherwise generated on
 * the first api start and kept in `app_secrets`, so `.env` needs no second secret and a restart
 * keeps everyone signed in. Two instances starting at once agree: the first insert wins, both
 * read it back.
 *
 * Loaded in `onModuleInit`, which `main.ts` reaches after the migrations.
 */
@Injectable()
export class JwtSecretService implements OnModuleInit {
  private secret: string | null = null

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    this.secret = this.env.JWT_SECRET ?? (await this.loadOrCreate())
  }

  get(): string {
    if (this.secret === null) throw new Error('The JWT secret was read before it was loaded')
    return this.secret
  }

  private async loadOrCreate(): Promise<string> {
    await this.db
      .insert(appSecrets)
      .values({ name: SECRET_NAME, value: randomBytes(64).toString('base64url') })
      .onConflictDoNothing({ target: appSecrets.name })
    const [row] = await this.db
      .select({ value: appSecrets.value })
      .from(appSecrets)
      .where(eq(appSecrets.name, SECRET_NAME))
    if (!row) throw new Error('app_secrets has no JWT secret right after inserting it')
    return row.value
  }
}

import { errorResponseSchema, healthResponseSchema } from '@cv/shared'
import { Controller, Get, Inject } from '@nestjs/common'
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import { sql } from 'drizzle-orm'
import { PinoLogger } from 'nestjs-pino'
import { Public } from '../common/auth/public.decorator'
import { AppError } from '../common/errors/app-error'
import { DATABASE, type Database } from '../database/database.module'

/** `GET /api/health`: `200 { status: "ok" }` while Postgres answers `SELECT 1`, else `503`. No auth. */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthController.name)
  }

  @Get()
  @ApiOperation({ summary: 'Check that the api is up and the database answers' })
  @ApiOkResponse({ standardSchema: healthResponseSchema })
  @ApiServiceUnavailableResponse({
    description: '`INTERNAL`: the database is unavailable',
    standardSchema: errorResponseSchema,
  })
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.execute(sql`select 1`)
    } catch (error) {
      this.logger.error({ err: error }, 'database unavailable')
      throw new AppError(503, 'INTERNAL', 'The database is unavailable.')
    }
    return { status: 'ok' }
  }
}

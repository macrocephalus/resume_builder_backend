import { type Usage, usageResponseSchema } from '@cv/shared'
import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { ApiSession } from '../common/openapi/api-docs.decorators'
import { LimitsService } from './limits.service'

/** The limits a user has used, shown before they hit a `429` (docs/api.md). */
@ApiTags('usage')
@ApiSession()
@Controller('usage')
export class UsageController {
  constructor(private readonly limitsService: LimitsService) {}

  @Get()
  @ApiOperation({ summary: 'Generations used in the last hour and CVs in progress' })
  @ApiOkResponse({ standardSchema: usageResponseSchema })
  async usage(@CurrentUser() userId: string): Promise<Usage> {
    return this.limitsService.usage(userId)
  }
}

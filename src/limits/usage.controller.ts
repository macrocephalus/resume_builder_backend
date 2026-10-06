import type { Usage } from '@cv/shared'
import { Controller, Get } from '@nestjs/common'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { LimitsService } from './limits.service'

/** The limits a user has used, shown before they hit a `429` (docs/api.md). */
@Controller('usage')
export class UsageController {
  constructor(private readonly limitsService: LimitsService) {}

  @Get()
  async usage(@CurrentUser() userId: string): Promise<Usage> {
    return this.limitsService.usage(userId)
  }
}

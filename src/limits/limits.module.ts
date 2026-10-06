import { Module } from '@nestjs/common'
import { GENERATION_LIMITS, GENERATION_LIMITS_DEFAULTS } from './generation-limits'
import { LimitsService } from './limits.service'
import { UsageController } from './usage.controller'

@Module({
  controllers: [UsageController],
  providers: [LimitsService, { provide: GENERATION_LIMITS, useValue: GENERATION_LIMITS_DEFAULTS }],
  exports: [LimitsService],
})
export class LimitsModule {}

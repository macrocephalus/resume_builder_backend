import { Module } from '@nestjs/common'
import { GENERATION_LIMITS, GENERATION_LIMITS_DEFAULTS } from './generation-limits'
import { LimitsService } from './limits.service'
import { UsageController } from './usage.controller'
import { WORDING_BUDGET, WORDING_BUDGET_DEFAULTS } from './wording-budget'
import { WordingBudgetService } from './wording-budget.service'

@Module({
  controllers: [UsageController],
  providers: [
    LimitsService,
    { provide: GENERATION_LIMITS, useValue: GENERATION_LIMITS_DEFAULTS },
    WordingBudgetService,
    { provide: WORDING_BUDGET, useValue: WORDING_BUDGET_DEFAULTS },
  ],
  exports: [LimitsService, WordingBudgetService],
})
export class LimitsModule {}

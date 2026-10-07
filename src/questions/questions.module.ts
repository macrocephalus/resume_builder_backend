import { Module } from '@nestjs/common'
import { ANSWER_WORDING_LIMITS } from '../agents/answer/answer-wording.schema'
import { FAST_LANGUAGE_MODEL, createLanguageModel } from '../agents/llm'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { CvsModule } from '../cvs/cvs.module'
import { LimitsModule } from '../limits/limits.module'
import { ANSWER_WORDING_TIMEOUT, AnswerWordingService } from './answer-wording.service'
import { QuestionsController } from './questions.controller'
import { QuestionsService } from './questions.service'

/** Replying to the questions of a CV, and wording the answers, in the api. */
@Module({
  imports: [CvsModule, LimitsModule],
  controllers: [QuestionsController],
  providers: [
    {
      provide: FAST_LANGUAGE_MODEL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createLanguageModel({ apiKey: env.ANTHROPIC_API_KEY, modelId: env.ANTHROPIC_FAST_MODEL }),
    },
    { provide: ANSWER_WORDING_TIMEOUT, useValue: ANSWER_WORDING_LIMITS.timeoutMs },
    AnswerWordingService,
    QuestionsService,
  ],
})
export class QuestionsModule {}

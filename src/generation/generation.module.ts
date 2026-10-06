import { Module } from '@nestjs/common'
import { LANGUAGE_MODEL, createLanguageModel } from '../agents/llm'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { CvsModule } from '../cvs/cvs.module'
import { GenerationProcessor } from './generation.processor'
import { DraftSaver } from './save-draft'

/**
 * The worker's half of `generation/`: the processor, the DraftAgent's model and the saving of a
 * draft. Sits above `cvs`, which it needs for the CV and its status.
 */
@Module({
  imports: [CvsModule],
  providers: [
    {
      provide: LANGUAGE_MODEL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createLanguageModel({ apiKey: env.ANTHROPIC_API_KEY, modelId: env.ANTHROPIC_MODEL }),
    },
    DraftSaver,
    GenerationProcessor,
  ],
})
export class GenerationModule {}

import { Module } from '@nestjs/common'
import { LANGUAGE_MODEL, createLanguageModel } from '../agents/llm'
import { ENV } from '../config/config.module'
import type { Env } from '../config/env.schema'
import { CvsModule } from '../cvs/cvs.module'
import { GenerationQueueModule } from './generation-queue.module'
import { GenerationProcessor } from './generation.processor'
import { QueueRecoveryService } from './queue-recovery.service'
import { DraftSaver } from './save-draft'

/**
 * The worker's half of `generation/`: the processor, the DraftAgent's model, the saving of a
 * draft and the queue recovery. Sits above `cvs`, which it needs for the CV and its status.
 */
@Module({
  imports: [CvsModule, GenerationQueueModule],
  providers: [
    {
      provide: LANGUAGE_MODEL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createLanguageModel({ apiKey: env.ANTHROPIC_API_KEY, modelId: env.ANTHROPIC_MODEL }),
    },
    DraftSaver,
    GenerationProcessor,
    QueueRecoveryService,
  ],
})
export class GenerationModule {}

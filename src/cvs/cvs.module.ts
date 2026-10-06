import { Module } from '@nestjs/common'
import { GenerationQueueModule } from '../generation/generation-queue.module'
import { LimitsModule } from '../limits/limits.module'
import { CvStatusService } from './cv-status.service'
import { CvsController } from './cvs.controller'
import { CvsService } from './cvs.service'

/** CVs and their ownership. Other modules reach a CV only through `CvsService.getOwned`. */
@Module({
  imports: [GenerationQueueModule, LimitsModule],
  controllers: [CvsController],
  providers: [CvsService, CvStatusService],
  // the generation processor and the questions load a CV and move its status
  exports: [CvsService, CvStatusService],
})
export class CvsModule {}

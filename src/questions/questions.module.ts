import { Module } from '@nestjs/common'
import { CvsModule } from '../cvs/cvs.module'
import { QuestionsController } from './questions.controller'
import { QuestionsService } from './questions.service'

/** Answering and skipping the questions of a CV, in the api. */
@Module({
  imports: [CvsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
})
export class QuestionsModule {}

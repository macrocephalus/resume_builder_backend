import { type Answer, answerSchema, type cvResponseSchema } from '@cv/shared'
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import type { z } from 'zod'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { ZodValidationPipe } from '../common/http/zod-validation.pipe'
import { QuestionsService } from './questions.service'

type CvResponse = z.infer<typeof cvResponseSchema>

/**
 * The questions of a CV (docs/api.md "Questions"). The body is checked here by its shape; the
 * service checks it against the question (its kind, its options).
 */
@Controller('cvs/:id/questions/:questionId')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post('answer')
  @HttpCode(200)
  async answer(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(answerSchema)) body: Answer,
  ): Promise<CvResponse> {
    return { cv: await this.questions.answer(userId, id, questionId, body) }
  }

  @Post('skip')
  @HttpCode(200)
  async skip(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ): Promise<CvResponse> {
    return { cv: await this.questions.skip(userId, id, questionId) }
  }
}

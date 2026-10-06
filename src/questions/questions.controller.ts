import { type Answer, answerSchema, cvResponseSchema } from '@cv/shared'
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { z } from 'zod'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { ZodValidationPipe } from '../common/http/zod-validation.pipe'
import { ApiErrors, ApiSession, ApiZodBody } from '../common/openapi/api-docs.decorators'
import { QuestionsService } from './questions.service'

type CvResponse = z.infer<typeof cvResponseSchema>

/**
 * The questions of a CV (docs/api.md "Questions"). The body is checked here by its shape; the
 * service checks it against the question (its kind, its options).
 */
@ApiTags('questions')
@ApiSession()
@Controller('cvs/:id/questions/:questionId')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post('answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer a question',
    description: 'The answer goes into the CV as written; the CV may become `ready`.',
  })
  @ApiZodBody(answerSchema)
  @ApiOkResponse({ standardSchema: cvResponseSchema })
  @ApiErrors('VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE')
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
  @ApiOperation({
    summary: 'Skip a question',
    description: 'The field stays empty; a `confirm` question cannot be skipped.',
  })
  @ApiOkResponse({ standardSchema: cvResponseSchema })
  @ApiErrors('NOT_FOUND', 'INVALID_STATE')
  async skip(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ): Promise<CvResponse> {
    return { cv: await this.questions.skip(userId, id, questionId) }
  }
}

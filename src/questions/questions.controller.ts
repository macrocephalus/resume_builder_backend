import { type RepliesBody, cvResponseSchema, repliesBodySchema } from '@cv/shared'
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
 * service checks each reply against its question (its kind, its options).
 */
@ApiTags('questions')
@ApiSession()
@Controller('cvs/:id')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post('replies')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer and skip questions together',
    description:
      'Every reply is checked first and nothing is applied if one fails; answers go into the CV ' +
      'as written, a skip (`answer: null`) leaves its field as it is; the CV may become `ready`.',
  })
  @ApiZodBody(repliesBodySchema)
  @ApiOkResponse({ standardSchema: cvResponseSchema })
  @ApiErrors('VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE')
  async reply(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(repliesBodySchema)) body: RepliesBody,
  ): Promise<CvResponse> {
    return { cv: await this.questions.reply(userId, id, body.replies) }
  }
}

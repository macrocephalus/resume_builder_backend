import {
  API_LIMITS,
  type CreateCvBody,
  createCvBodySchema,
  cvListResponseSchema,
  cvResponseSchema,
  cvStatusesQuerySchema,
  cvStatusesResponseSchema,
  type PatchCvBody,
  patchCvBodySchema,
} from '@cv/shared'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import type { z } from 'zod'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { ZodValidationPipe } from '../common/http/zod-validation.pipe'
import { ApiErrors, ApiSession, ApiZodBody } from '../common/openapi/api-docs.decorators'
import { pdfDisposition } from '../pdf/content-disposition'
import { CvsService } from './cvs.service'

type CvResponse = z.infer<typeof cvResponseSchema>
type CvListResponse = z.infer<typeof cvListResponseSchema>
type CvStatusesResponse = z.infer<typeof cvStatusesResponseSchema>
type CvStatusesQuery = z.infer<typeof cvStatusesQuerySchema>

/** The user's CVs (docs/api.md "CVs"). Every route works only on CVs the caller owns. */
@ApiTags('cvs')
@ApiSession()
@Controller('cvs')
export class CvsController {
  constructor(private readonly cvs: CvsService) {}

  /** `202`: the CV is queued and its generation runs in the worker. */
  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Create a CV and queue its generation',
    description:
      'From a new source (`sourceText`) or for another role from an existing CV (`fromCvId`): ' +
      'exactly one of the two.',
  })
  @ApiZodBody(createCvBodySchema)
  @ApiAcceptedResponse({
    description: 'Queued: `status: "queued"`, `data: null`',
    standardSchema: cvResponseSchema,
  })
  @ApiErrors('VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE', 'RATE_LIMITED', 'TOO_MANY_ACTIVE')
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createCvBodySchema)) body: CreateCvBody,
  ): Promise<CvResponse> {
    return { cv: await this.cvs.create(userId, body) }
  }

  @Get()
  @ApiOperation({ summary: 'List own CVs, the most recently updated first' })
  @ApiOkResponse({ standardSchema: cvListResponseSchema })
  async list(@CurrentUser() userId: string): Promise<CvListResponse> {
    return { items: await this.cvs.list(userId) }
  }

  // before ':id', so "statuses" is never read as an id
  @Get('statuses')
  @ApiOperation({ summary: 'Poll the statuses of several CVs' })
  @ApiQuery({
    name: 'ids',
    description: `1–${API_LIMITS.statusIds} comma-separated CV ids; unknown and foreign ids are left out`,
    schema: { type: 'string' },
  })
  @ApiOkResponse({ standardSchema: cvStatusesResponseSchema })
  @ApiErrors('VALIDATION_ERROR')
  async statuses(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(cvStatusesQuerySchema)) query: CvStatusesQuery,
  ): Promise<CvStatusesResponse> {
    return { items: await this.cvs.statuses(userId, query.ids) }
  }

  @Get(':id')
  @ApiOperation({ summary: 'A CV with its draft, questions and requirements' })
  @ApiOkResponse({ standardSchema: cvResponseSchema })
  @ApiErrors('NOT_FOUND', 'DATA_CORRUPT')
  async get(@CurrentUser() userId: string, @Param('id') id: string): Promise<CvResponse> {
    return { cv: await this.cvs.get(userId, id) }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit the title or the draft by hand',
    description:
      '`data` replaces the whole draft; `version` must be the one the edit started from.',
  })
  @ApiZodBody(patchCvBodySchema)
  @ApiOkResponse({ description: 'Saved with `version + 1`', standardSchema: cvResponseSchema })
  @ApiErrors('VALIDATION_ERROR', 'NOT_FOUND', 'VERSION_CONFLICT', 'INVALID_STATE')
  async edit(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchCvBodySchema)) body: PatchCvBody,
  ): Promise<CvResponse> {
    return { cv: await this.cvs.edit(userId, id, body) }
  }

  /** `200 application/pdf`, an attachment named after the CV's title. */
  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download the saved CV as an A4 PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'An attachment named after the CV title',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrors('NOT_FOUND', 'INVALID_STATE')
  async pdf(@CurrentUser() userId: string, @Param('id') id: string): Promise<StreamableFile> {
    const { pdf, title } = await this.cvs.pdf(userId, id)
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: pdfDisposition(title),
      length: pdf.length,
    })
  }

  /** `202`: the failed CV is queued again. */
  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a failed CV again' })
  @ApiAcceptedResponse({ standardSchema: cvResponseSchema })
  @ApiErrors('NOT_FOUND', 'INVALID_STATE', 'RATE_LIMITED', 'TOO_MANY_ACTIVE')
  async retry(@CurrentUser() userId: string, @Param('id') id: string): Promise<CvResponse> {
    return { cv: await this.cvs.retry(userId, id) }
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a CV in any status' })
  @ApiNoContentResponse()
  @ApiErrors('NOT_FOUND')
  async delete(@CurrentUser() userId: string, @Param('id') id: string): Promise<void> {
    await this.cvs.delete(userId, id)
  }
}

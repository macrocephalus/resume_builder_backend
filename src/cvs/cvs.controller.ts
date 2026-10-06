import {
  type CreateCvBody,
  createCvBodySchema,
  type cvListResponseSchema,
  type cvResponseSchema,
  cvStatusesQuerySchema,
  type cvStatusesResponseSchema,
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
import type { z } from 'zod'
import { CurrentUser } from '../common/auth/current-user.decorator'
import { ZodValidationPipe } from '../common/http/zod-validation.pipe'
import { pdfDisposition } from '../pdf/content-disposition'
import { CvsService } from './cvs.service'

type CvResponse = z.infer<typeof cvResponseSchema>
type CvListResponse = z.infer<typeof cvListResponseSchema>
type CvStatusesResponse = z.infer<typeof cvStatusesResponseSchema>
type CvStatusesQuery = z.infer<typeof cvStatusesQuerySchema>

/** The user's CVs (docs/api.md "CVs"). Every route works only on CVs the caller owns. */
@Controller('cvs')
export class CvsController {
  constructor(private readonly cvs: CvsService) {}

  /** `202`: the CV is queued and its generation runs in the worker. */
  @Post()
  @HttpCode(202)
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createCvBodySchema)) body: CreateCvBody,
  ): Promise<CvResponse> {
    return { cv: await this.cvs.create(userId, body) }
  }

  @Get()
  async list(@CurrentUser() userId: string): Promise<CvListResponse> {
    return { items: await this.cvs.list(userId) }
  }

  // before ':id', so "statuses" is never read as an id
  @Get('statuses')
  async statuses(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(cvStatusesQuerySchema)) query: CvStatusesQuery,
  ): Promise<CvStatusesResponse> {
    return { items: await this.cvs.statuses(userId, query.ids) }
  }

  @Get(':id')
  async get(@CurrentUser() userId: string, @Param('id') id: string): Promise<CvResponse> {
    return { cv: await this.cvs.get(userId, id) }
  }

  @Patch(':id')
  async edit(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchCvBodySchema)) body: PatchCvBody,
  ): Promise<CvResponse> {
    return { cv: await this.cvs.edit(userId, id, body) }
  }

  /** `200 application/pdf`, an attachment named after the CV's title. */
  @Get(':id/pdf')
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
  async retry(@CurrentUser() userId: string, @Param('id') id: string): Promise<CvResponse> {
    return { cv: await this.cvs.retry(userId, id) }
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id') id: string): Promise<void> {
    await this.cvs.delete(userId, id)
  }
}

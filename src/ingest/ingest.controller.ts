import { API_LIMITS, type IngestedPdf, ingestPdfResponseSchema } from '@cv/shared'
import { Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RateLimit } from '../common/http/rate-limit'
import { ApiErrors, ApiSession } from '../common/openapi/api-docs.decorators'
import { PDF_UPLOAD, THROTTLES } from '../config/limits'
import { IngestService, type UploadedPdf } from './ingest.service'

/** `POST /api/ingest/pdf`: extract the text of an uploaded PDF and store nothing. */
@ApiTags('intake')
@ApiSession()
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('pdf')
  @HttpCode(200)
  @RateLimit(THROTTLES.ingest, 'user')
  // no `dest` / `storage`: multer keeps the file in memory; a bigger file is cut off → 413.
  // Filenames are read as UTF-8, so a Cyrillic name comes back intact.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { ...PDF_UPLOAD, fileSize: API_LIMITS.pdf.bytes },
      defParamCharset: 'utf8',
    }),
  )
  @ApiOperation({ summary: 'Extract the text of a PDF; nothing is stored' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `A PDF with a text layer: ≤ ${API_LIMITS.pdf.bytes / 1024 / 1024} MB, ≤ ${API_LIMITS.pdf.pages} pages`,
        },
      },
    },
  })
  @ApiOkResponse({ standardSchema: ingestPdfResponseSchema })
  @ApiErrors(
    'VALIDATION_ERROR',
    'INPUT_TOO_LARGE',
    'UNSUPPORTED_FILE',
    'PDF_UNREADABLE',
    'RATE_LIMITED',
  )
  read(@UploadedFile() file: UploadedPdf | undefined): Promise<IngestedPdf> {
    return this.ingest.read(file)
  }
}

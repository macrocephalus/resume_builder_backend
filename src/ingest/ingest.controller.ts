import { API_LIMITS, type IngestedPdf } from '@cv/shared'
import { Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { RateLimit } from '../common/http/rate-limit'
import { PDF_UPLOAD, THROTTLES } from '../config/limits'
import { IngestService, type UploadedPdf } from './ingest.service'

/** `POST /api/ingest/pdf`: extract the text of an uploaded PDF and store nothing. */
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
  read(@UploadedFile() file: UploadedPdf | undefined): Promise<IngestedPdf> {
    return this.ingest.read(file)
  }
}

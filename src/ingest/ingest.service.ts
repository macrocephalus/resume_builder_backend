import type { IngestedPdf } from '@cv/shared'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../common/errors/app-error'
import { echoFilename, readPdf } from './pdf-text'

/** The part of an upload the service reads; multer keeps it in memory for the request only. */
export type UploadedPdf = { buffer: Buffer; originalname: string }

@Injectable()
export class IngestService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(IngestService.name)
  }

  /** PDF → text for the user to review (docs/api.md "Intake"). Multer already checked the size. */
  async read(file: UploadedPdf | undefined): Promise<IngestedPdf> {
    if (!file) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Attach a PDF file.', {
        fields: { file: 'Required' },
      })
    }
    const result = await readPdf(file.buffer)
    switch (result.kind) {
      case 'not-pdf':
        throw new AppError(415, 'UNSUPPORTED_FILE', 'This file is not a PDF.')
      case 'too-many-pages':
        throw new AppError(
          413,
          'INPUT_TOO_LARGE',
          `The PDF has ${result.pages} pages; the limit is ${result.limit}.`,
        )
      case 'unreadable':
        if (result.error !== undefined) {
          this.logger.warn(
            { err: result.error, size: file.buffer.length },
            'pdf could not be parsed',
          )
        }
        throw new AppError(422, 'PDF_UNREADABLE', 'The PDF has no text to read.')
      case 'text':
        return {
          text: result.text,
          pages: result.pages,
          chars: result.text.length,
          filename: echoFilename(file.originalname),
        }
    }
  }
}

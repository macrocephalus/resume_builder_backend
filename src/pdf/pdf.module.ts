import { Module } from '@nestjs/common'
import { readCvFonts } from './fonts'

/** Injection token for the bundled fonts (`CvFonts`), read from disk once per process. */
export const PDF_FONTS = Symbol('PDF_FONTS')

/** Drawing a CV as a PDF; the route that serves it is in `cvs`. */
@Module({
  providers: [{ provide: PDF_FONTS, useFactory: readCvFonts }],
  exports: [PDF_FONTS],
})
export class PdfModule {}

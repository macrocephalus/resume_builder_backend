import type { CvData, CvLanguage } from '@cv/shared'

/** What a template draws: the saved draft and the language its headings are in. */
export type PdfCv = { data: CvData; language: CvLanguage }

/** The fonts `renderCvPdf` registers before a template runs, by the names a template uses. */
export const FONT = { regular: 'regular', bold: 'bold' } as const
export type FontName = (typeof FONT)[keyof typeof FONT]

/** Draws a CV onto an open A4 document; pdfkit adds the pages. */
export type CvTemplate = (cv: PdfCv, doc: PDFKit.PDFDocument) => void

import type { CvData, CvLanguage } from '@cv/shared'
import PDFDocument from 'pdfkit'
import type { CvFonts } from './fonts'
import { classic } from './templates/classic'

/** On every side of the page, in points. */
const MARGIN = 50

/**
 * The CV as an A4 PDF (595×842 pt) with real, selectable text (backend architecture §7, root
 * §10), drawn by the one template with `fonts` embedded. No I/O: the fonts come in as bytes.
 */
export const renderCvPdf = (data: CvData, language: CvLanguage, fonts: CvFonts): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      lang: language,
      info: { Title: data.contacts.fullName ?? undefined },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      for (const [name, bytes] of Object.entries(fonts)) doc.registerFont(name, bytes)
      classic({ data, language }, doc)
      doc.end()
    } catch (error) {
      reject(error)
    }
  })

import { API_LIMITS } from '@cv/shared'
import { getResolvedPDFJS } from 'unpdf'

const PDF_MAGIC = Buffer.from('%PDF')

/** What reading an uploaded file came to; the service turns each kind into a response. */
export type PdfRead =
  | { kind: 'text'; text: string; pages: number }
  | { kind: 'not-pdf' }
  | { kind: 'too-many-pages'; pages: number; limit: number }
  /** pdf.js could not parse it (`error`), or its text layer is (nearly) empty: a scan */
  | { kind: 'unreadable'; error?: unknown }

/** Characters other than whitespace: what decides whether a PDF had text to read. */
const visibleLength = (text: string) => text.replace(/\s/g, '').length

/**
 * Checks an uploaded file by its content and reads its text layer (no OCR), in the order of
 * docs/api.md: `%PDF` magic bytes, page count, then at least `API_LIMITS.pdf.minChars` visible
 * characters. Pages are joined by a blank line. Bytes in memory only; nothing is written.
 */
export const readPdf = async (bytes: Uint8Array): Promise<PdfRead> => {
  const { pages: maxPages, minChars } = API_LIMITS.pdf
  if (!Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).equals(PDF_MAGIC))
    return { kind: 'not-pdf' }

  const { getDocument } = await getResolvedPDFJS()
  const task = getDocument({
    // a copy: pdf.js may take over the buffer it is given
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    if (document.numPages > maxPages) {
      return { kind: 'too-many-pages', pages: document.numPages, limit: maxPages }
    }
    const pageTexts: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const { items } = await page.getTextContent()
      pageTexts.push(
        items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join('')
          .trim(),
      )
    }
    const text = pageTexts.filter((page) => page.length > 0).join('\n\n')
    if (visibleLength(text) < minChars) return { kind: 'unreadable' }
    return { kind: 'text', text, pages: document.numPages }
  } catch (error) {
    return { kind: 'unreadable', error }
  } finally {
    // also when parsing failed: frees what pdf.js holds for the file
    await task.destroy()
  }
}

/** The upload's name as the response echoes it: at most 200 characters, never split mid-letter. */
export const echoFilename = (name: string): string =>
  Array.from(name).slice(0, API_LIMITS.sourceFilename).join('')

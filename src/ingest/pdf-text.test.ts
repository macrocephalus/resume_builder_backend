import { describe, expect, it } from 'vitest'
import { buildPdf, textPage } from '../../test/helpers/pdf'
import { echoFilename, readPdf } from './pdf-text'

const pages = (count: number) =>
  buildPdf(Array.from({ length: count }, (_, i) => textPage(`Page ${i + 1}`)))

describe('readPdf', () => {
  it('reads the text layer of every page, pages joined by a blank line', async () => {
    const result = await readPdf(buildPdf([textPage('Olena Hnatiuk'), textPage('Experience')]))
    expect(result).toEqual({ kind: 'text', text: expect.any(String), pages: 2 })
    if (result.kind !== 'text') return
    const [first, second] = result.text.split('\n\n')
    expect(first).toMatch(/^Olena Hnatiuk\n/)
    expect(second).toMatch(/^Experience\n/)
  })

  it('judges the content, not a name: anything not starting with %PDF is not a PDF', async () => {
    expect(await readPdf(Buffer.from('Olena Hnatiuk, backend engineer'.repeat(5)))).toEqual({
      kind: 'not-pdf',
    })
    expect(await readPdf(Buffer.from(' %PDF-1.4 with a leading space'))).toEqual({
      kind: 'not-pdf',
    })
  })

  it('takes 10 pages and refuses 11 with the count and the limit', async () => {
    expect((await readPdf(pages(10))).kind).toBe('text')
    expect(await readPdf(pages(11))).toEqual({ kind: 'too-many-pages', pages: 11, limit: 10 })
  })

  it('calls a PDF without text (a scan) unreadable, with no parse error', async () => {
    expect(await readPdf(buildPdf([{ image: true }, { image: true }]))).toEqual({
      kind: 'unreadable',
    })
  })

  it('calls a PDF pdf.js cannot parse unreadable and keeps the error for the log', async () => {
    const result = await readPdf(Buffer.from('%PDF-1.7\nthis is not a pdf body at all'))
    expect(result).toEqual({ kind: 'unreadable', error: expect.anything() })
  })

  it('needs 50 visible characters: whitespace and page breaks do not count', async () => {
    // 49 letters over two pages with plenty of spaces between them
    const spaced = buildPdf([
      { lines: ['a b c d e f g h i j k l m n o p q r s t u v w x y'] },
      { lines: ['a b c d e f g h i j k l m n o p q r s t u v w x'] },
    ])
    expect(await readPdf(spaced)).toEqual({ kind: 'unreadable' })

    const fifty = buildPdf([{ lines: ['a'.repeat(25)] }, { lines: ['b'.repeat(25)] }])
    expect((await readPdf(fifty)).kind).toBe('text')
  })
})

describe('echoFilename', () => {
  it('keeps a name up to 200 characters as it is', () => {
    expect(echoFilename('Резюме Олени.pdf')).toBe('Резюме Олени.pdf')
    expect(echoFilename('a'.repeat(200))).toBe('a'.repeat(200))
  })

  it('cuts a longer one at 200 characters without splitting a character', () => {
    expect(echoFilename(`${'a'.repeat(199)}😀😀.pdf`)).toBe(`${'a'.repeat(199)}😀`)
  })
})

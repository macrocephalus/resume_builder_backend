/**
 * Builds small, valid PDFs for the intake tests, so the fixtures are readable in the test
 * instead of being binary files: a page is either lines of text (Helvetica) or one image and no
 * text at all, like a scan.
 */
export type PdfPage = { lines: string[] } | { image: true }

const escapeText = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`)

const content = (page: PdfPage): string =>
  'image' in page
    ? 'q 200 0 0 200 50 500 cm /Im1 Do Q'
    : `BT /F1 12 Tf 14 TL 50 790 Td ${page.lines.map((line) => `(${escapeText(line)}) Tj T*`).join(' ')} ET`

const stream = (body: string, dictionary = '') =>
  `<< ${dictionary}/Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`

export const buildPdf = (pages: PdfPage[]): Buffer => {
  // 1 catalog, 2 page tree, 3 font, 4 image; then a page object and its content per page
  const pageId = (index: number) => 5 + index * 2
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(
      '\x00\xff\xff\x00',
      '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 ',
    ),
    ...pages.flatMap((page, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>`,
      stream(content(page)),
    ]),
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** A page of plain CV text, long enough to pass the minimum on its own. */
export const textPage = (heading: string): PdfPage => ({
  lines: [
    heading,
    'Backend engineer with eight years of Node.js and PostgreSQL.',
    'Kyiv, 2018 - 2026',
  ],
})

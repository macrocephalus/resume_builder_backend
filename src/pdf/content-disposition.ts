/** Characters no file name may hold on Windows, macOS or Linux, and the control characters. */
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/gu

const tidy = (name: string): string => name.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim()

/** The name in printable ASCII: accents dropped ("Zoë" → "Zoe"), other letters left out. */
const ascii = (name: string): string =>
  tidy(
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\x20-\x7e]/g, ' '),
  )

/** RFC 5987: what `encodeURIComponent` leaves that a `filename*` value may not hold. */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * `Content-Disposition` of a CV's PDF, named after its title (docs/api.md): an ASCII
 * `filename` every client reads, and the whole title in `filename*` when it has other letters.
 * "CV" when the title leaves nothing.
 */
export const pdfDisposition = (title: string): string => {
  const name = tidy(title)
  const fallback = ascii(name) || 'CV'
  const header = `attachment; filename="${fallback}.pdf"`
  return name === '' || name === fallback
    ? header
    : `${header}; filename*=UTF-8''${encodeRfc5987(name)}.pdf`
}

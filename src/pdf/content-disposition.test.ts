import { describe, expect, it } from 'vitest'
import { pdfDisposition } from './content-disposition'

describe('pdfDisposition', () => {
  it('names a Latin title as it is', () => {
    expect(pdfDisposition('Senior Backend Engineer')).toBe(
      'attachment; filename="Senior Backend Engineer.pdf"',
    )
  })

  it('drops characters no file name may hold and collapses the spaces', () => {
    expect(pdfDisposition(' Backend / Node.js: "Lead" \\ 2026?\t')).toBe(
      'attachment; filename="Backend Node.js Lead 2026.pdf"',
    )
  })

  it('gives a non-Latin title an ASCII fallback and the full name in filename*', () => {
    expect(pdfDisposition('Олена — Backend')).toBe(
      'attachment; filename="Backend.pdf"; filename*=UTF-8\'\'%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0%20%E2%80%94%20Backend.pdf',
    )
  })

  it('keeps the Latin letter of an accented one in the fallback', () => {
    expect(pdfDisposition('Zoë Müller (CV)')).toBe(
      'attachment; filename="Zoe Muller (CV).pdf"; filename*=UTF-8\'\'Zo%C3%AB%20M%C3%BCller%20%28CV%29.pdf',
    )
  })

  it('falls back to "CV" when nothing of the title is left', () => {
    expect(pdfDisposition('Резюме')).toBe(
      'attachment; filename="CV.pdf"; filename*=UTF-8\'\'%D0%A0%D0%B5%D0%B7%D1%8E%D0%BC%D0%B5.pdf',
    )
    expect(pdfDisposition('///')).toBe('attachment; filename="CV.pdf"')
  })
})

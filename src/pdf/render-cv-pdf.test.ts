import type { CvData } from '@cv/shared'
import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { readCvFonts } from './fonts'
import { renderCvPdf } from './render-cv-pdf'

const FONTS = readCvFonts()

const JOB = '11111111-1111-4111-8111-111111111111'

const SECTION_ORDER: CvData['sectionOrder'] = [
  'summary',
  'experience',
  'projects',
  'education',
  'certifications',
  'skills',
  'languages',
]

const onlyName = (): CvData => ({
  contacts: { fullName: 'Olena Hnatiuk', email: null, phone: null, location: null, links: [] },
  summary: null,
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: [],
  languages: [],
  sectionOrder: SECTION_ORDER,
})

const full = (): CvData => ({
  ...onlyName(),
  contacts: {
    fullName: 'Олена Гнатюк',
    email: 'olena@example.com',
    phone: '+380 67 123 45 67',
    location: 'Київ',
    links: ['github.com/olena'],
  },
  summary: 'Бекенд-інженерка з восьмирічним досвідом у платежах.',
  experience: [
    {
      id: JOB,
      title: 'Backend Engineer',
      company: null,
      period: '2019 – present',
      bullets: ['Перевела авторизацію карток на outbox'],
    },
  ],
  skills: ['Node.js', 'PostgreSQL'],
  languages: [{ id: '22222222-2222-4222-8222-222222222222', name: 'English', level: 'B2' }],
})

/** The text layer, one string; what a reader selects and searches. */
const textOf = async (pdf: Buffer) => {
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true })
  return text
}

describe('renderCvPdf', () => {
  it('draws on A4 pages', async () => {
    const pdf = await getDocumentProxy(new Uint8Array(await renderCvPdf(full(), 'uk', FONTS)))
    const [, , width, height] = (await pdf.getPage(1)).view
    expect([Math.round(width ?? 0), Math.round(height ?? 0)]).toEqual([595, 842])
  })

  it('writes real text: the name, a bullet and the headings in the CV language', async () => {
    const text = await textOf(await renderCvPdf(full(), 'uk', FONTS))
    expect(text).toContain('Олена Гнатюк')
    expect(text).toContain('Перевела авторизацію карток на outbox')
    expect(text).toContain('ДОСВІД')
    expect(text).toContain('olena@example.com · +380 67 123 45 67 · Київ · github.com/olena')
    expect(text).toContain('Node.js, PostgreSQL')
    expect(text).toContain('English (B2)')
  })

  it('leaves out a missing part and the separator next to it', async () => {
    const text = await textOf(await renderCvPdf(full(), 'en', FONTS))
    expect(text).toContain('Backend Engineer')
    expect(text).not.toContain('Backend Engineer,')
  })

  it('draws no heading for an empty block and never "undefined" or "null"', async () => {
    const text = await textOf(await renderCvPdf(onlyName(), 'en', FONTS))
    expect(text.trim()).toBe('Olena Hnatiuk')
  })

  it('puts the blocks in the order of sectionOrder', async () => {
    const data = full()
    data.sectionOrder = [
      'skills',
      'experience',
      'summary',
      'projects',
      'education',
      'certifications',
      'languages',
    ]
    const text = await textOf(await renderCvPdf(data, 'en', FONTS))
    const at = (heading: string) => text.indexOf(heading)
    expect(at('SKILLS')).toBeGreaterThan(-1)
    expect(at('SKILLS')).toBeLessThan(at('EXPERIENCE'))
    expect(at('EXPERIENCE')).toBeLessThan(at('SUMMARY'))
  })

  it('goes on to more pages with every bullet next to its dot', async () => {
    // page breaks land in different places for different numbers of bullets per job
    for (let perJob = 3; perJob <= 9; perJob++) {
      const data = full()
      data.experience = Array.from({ length: 10 }, (_, index) => ({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        title: `Job ${index}`,
        company: 'Fintory',
        period: '2019',
        bullets: Array.from({ length: perJob }, (_, line) =>
          `Moved card authorisations ${index}.${line} to an outbox pattern`.repeat(1 + (line % 2)),
        ),
      }))
      const pdf = await getDocumentProxy(new Uint8Array(await renderCvPdf(data, 'en', FONTS)))
      expect(pdf.numPages).toBeGreaterThan(1)
      for (let number = 1; number <= pdf.numPages; number++) {
        const { items } = await (await pdf.getPage(number)).getTextContent()
        const lines = items.flatMap((item) =>
          'str' in item && item.str.trim() !== '' ? [item.str] : [],
        )
        // a dot alone at the end of a page, or a bullet without its dot at the top of one
        expect(lines.at(-1), `${perJob} per job, page ${number}`).not.toBe('•')
        expect(lines[0], `${perJob} per job, page ${number}`).not.toMatch(/^Moved card/)
      }
    }
  })
})

import { type CvData, type CvSection, getCvLanguage, isSectionEmpty } from '@cv/shared'
import { type CvTemplate, FONT, type FontName } from '../cv-template'

type Style = { font: FontName; size: number; color: string }

const COLOR = { text: '#111111', muted: '#666666', rule: '#cccccc' } as const

const STYLE = {
  name: { font: FONT.bold, size: 20, color: COLOR.text },
  contacts: { font: FONT.regular, size: 10, color: COLOR.muted },
  heading: { font: FONT.bold, size: 9, color: COLOR.text },
  line: { font: FONT.bold, size: 11, color: COLOR.text },
  muted: { font: FONT.regular, size: 9, color: COLOR.muted },
  body: { font: FONT.regular, size: 10, color: COLOR.text },
} as const satisfies Record<string, Style>

const BULLET_INDENT = 14

/** Room a heading needs below it so it never ends a page alone: its rule and a first line. */
const HEADING_KEEP = 40

type MovableSection = CvData['sectionOrder'][number]

/** The value when it is filled in, else `''`. */
const present = (value: string | null): string => (value === null ? '' : value.trim())

/** The parts that are filled in, joined: "Title" alone, never "Title, ". */
const joined = (parts: ReadonlyArray<string | null>, separator: string): string =>
  parts
    .map(present)
    .filter((part) => part !== '')
    .join(separator)

/** One item of a block: its bold line, its muted line and its bullets, each only when present. */
type Entry = { line: string; muted: string; bullets: readonly string[] }

/** What a block draws under its heading: one paragraph, or one entry per item. */
type Block = { paragraph: string } | { entries: Entry[] }

/** The layout of every block (root `docs/architecture.md` §10), one place per block. */
const BLOCKS: Record<MovableSection, (data: CvData) => Block> = {
  summary: (data) => ({ paragraph: present(data.summary) }),
  experience: (data) => ({
    entries: data.experience.map((item) => ({
      line: joined([item.title, item.company], ', '),
      muted: present(item.period),
      bullets: item.bullets,
    })),
  }),
  projects: (data) => ({
    entries: data.projects.map((item) => ({
      line: present(item.name),
      muted: joined([item.period, item.url], ' · '),
      bullets: item.bullets,
    })),
  }),
  education: (data) => ({
    entries: data.education.map((item) => ({
      line: joined([item.institution, item.degree], ', '),
      muted: present(item.period),
      bullets: [],
    })),
  }),
  certifications: (data) => ({
    entries: data.certifications.map((item) => ({
      line: joined([item.name, item.issuer], ', '),
      muted: present(item.year),
      bullets: [],
    })),
  }),
  skills: (data) => ({ paragraph: joined(data.skills, ', ') }),
  languages: (data) => ({
    paragraph: joined(
      data.languages.map((item) =>
        joined([item.name, item.level === null ? null : `(${item.level})`], ' '),
      ),
      ', ',
    ),
  }),
}

/**
 * The product's one layout: the name and a contacts line, then the blocks in `sectionOrder`,
 * each under an uppercase heading with a rule. Empty blocks and missing parts are left out.
 */
export const classic: CvTemplate = ({ data, language }, doc) => {
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  const headings: Record<CvSection, string> = getCvLanguage(language).headings

  const write = (text: string, { font, size, color }: Style, indent = 0, y?: number) => {
    if (text === '') return
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(text, left + indent, y, { width: width - indent })
  }

  /** A new page when `height` no longer fits on this one. */
  const keepRoom = (height: number) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
  }

  const heading = (text: string) => {
    doc.moveDown(0.8)
    keepRoom(HEADING_KEEP)
    write(text.toUpperCase(), STYLE.heading)
    const y = doc.y + 1
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.5)
      .strokeColor(COLOR.rule)
      .stroke()
    doc.y = y + 4
  }

  const entry = ({ line, muted, bullets }: Entry) => {
    write(line, STYLE.line)
    write(muted, STYLE.muted)
    for (const bullet of bullets.map(present).filter((text) => text !== '')) {
      // the dot and its text start on one page: the dot is drawn at the text's y
      const { font, size } = STYLE.body
      keepRoom(
        doc
          .font(font)
          .fontSize(size)
          .heightOfString(bullet, { width: width - BULLET_INDENT }),
      )
      const y = doc.y
      write('•', STYLE.body, 0, y)
      write(bullet, STYLE.body, BULLET_INDENT, y)
    }
    doc.moveDown(0.4)
  }

  const { fullName, email, phone, location, links } = data.contacts
  write(present(fullName), STYLE.name)
  write(joined([email, phone, location, ...links], ' · '), STYLE.contacts)

  for (const section of data.sectionOrder) {
    if (isSectionEmpty(data, section)) continue
    heading(headings[section])
    const block = BLOCKS[section](data)
    if ('paragraph' in block) write(block.paragraph, STYLE.body)
    else for (const item of block.entries) entry(item)
  }
}

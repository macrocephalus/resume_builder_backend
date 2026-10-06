import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FONT, type FontName } from './cv-template'

/** The bundled font files, by the names a template uses. */
export type CvFonts = Record<FontName, Buffer>

/** Liberation Sans 2.1.5 (SIL OFL): Latin, Cyrillic and Greek, the scripts of every CV language. */
const FONTS_FOLDER = resolve(__dirname, '..', '..', 'assets', 'fonts')

/** Reads the fonts from `assets/fonts`, which ships in the image (`package.json` `files`). */
export const readCvFonts = (): CvFonts => ({
  [FONT.regular]: readFileSync(resolve(FONTS_FOLDER, 'LiberationSans-Regular.ttf')),
  [FONT.bold]: readFileSync(resolve(FONTS_FOLDER, 'LiberationSans-Bold.ttf')),
})

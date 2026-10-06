/**
 * How the verifier compares text (backend architecture §4): one case, one kind of quote and dash,
 * single spaces. NFKC folds look-alike characters (a no-break space, a full-width digit).
 */
export const normalise = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char)

/**
 * True when `word` occurs in `text` with no letter or digit right before or after it, so "java" is
 * not found in "javascript" while "node.js" and "c++" are found as written. The caller passes both
 * normalised.
 */
export const containsWord = (text: string, word: string): boolean => {
  if (word === '') return false
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + word.length])) return true
  }
  return false
}

// a run of digits, with thousands groups ("1,200", "1 200") and a decimal part of one or two
// digits ("2.5", "99.95"); "03.2019" is a month and a year, two numbers
const NUMBER = /\d+(?:[ ,.]\d{3}(?!\d))*(?:[.,]\d{1,2}(?!\d))?/g

/**
 * The numbers in `text` as bare digits without leading zeros: "1,200" and "1 200" are both
 * "1200", "03" is "3". A number is compared by its digits, whatever separators a language uses.
 */
export const numbersIn = (text: string): string[] =>
  (text.normalize('NFKC').match(NUMBER) ?? []).map((number) =>
    number.replace(/\D/g, '').replace(/^0+(?=\d)/, ''),
  )

export const digitsOf = (text: string): string => text.normalize('NFKC').replace(/\D/g, '')

/** A link without its scheme, `www.` and trailing slashes: "https://github.com/o/" → "github.com/o". */
export const linkKey = (link: string): string =>
  normalise(link)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')

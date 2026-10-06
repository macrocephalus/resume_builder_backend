import { describe, expect, it } from 'vitest'
import { containsWord, digitsOf, linkKey, normalise, numbersIn } from './normalise'

describe('normalise', () => {
  it('folds case, quotes, dashes and whitespace', () => {
    expect(normalise('  «Fintory» —  Kyiv’s\n2019–2021 ')).toBe(`"fintory" - kyiv's 2019-2021`)
  })
})

describe('containsWord', () => {
  it('finds a whole word only, punctuation inside the word included', () => {
    expect(containsWord('node.js and c++', 'node.js')).toBe(true)
    expect(containsWord('node.js and c++', 'c++')).toBe(true)
    expect(containsWord('javascript', 'java')).toBe(false)
    expect(containsWord('java, go', 'java')).toBe(true)
  })
})

describe('numbersIn', () => {
  it('reads numbers by their digits, whatever the separators', () => {
    expect(numbersIn('1,200 users, 1 200 users, 40%, 2.5x, 03/2019')).toEqual([
      '1200',
      '1200',
      '40',
      '25',
      '3',
      '2019',
    ])
  })

  it('keeps two years apart', () => {
    expect(numbersIn('2019 2021, 2019-2021')).toEqual(['2019', '2021', '2019', '2021'])
  })

  it('reads a month and a year as two numbers', () => {
    expect(numbersIn('03.2019 – 05.2021')).toEqual(['3', '2019', '5', '2021'])
  })
})

describe('linkKey', () => {
  it('drops the scheme, www and trailing slashes', () => {
    expect(linkKey('https://www.GitHub.com/olena/')).toBe('github.com/olena')
  })
})

describe('digitsOf', () => {
  it('keeps the digits of a phone as people write it', () => {
    expect(digitsOf('+38 (067) 123-45-67')).toBe('380671234567')
  })
})

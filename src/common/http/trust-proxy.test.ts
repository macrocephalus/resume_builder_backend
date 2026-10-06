import { describe, expect, it } from 'vitest'
import { isPrivateAddress, trustProxy } from './trust-proxy'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.0.5',
    '::ffff:172.20.0.4',
    '::1',
    'fd00::1',
    'fe80::1',
  ])('%s is a private network address', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '172.32.0.1', '203.0.113.9', '::ffff:8.8.8.8', '2001:db8::1', 'nonsense'])(
    '%s is not',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )
})

describe('trustProxy', () => {
  it('trusts only the direct peer, and only on a private network (the web container)', () => {
    expect(trustProxy('172.20.0.4', 0)).toBe(true)
    expect(trustProxy('8.8.8.8', 0)).toBe(false)
  })

  it('never trusts an address further down X-Forwarded-For, which the client could write', () => {
    expect(trustProxy('172.20.0.1', 1)).toBe(false)
    expect(trustProxy('127.0.0.1', 2)).toBe(false)
  })
})

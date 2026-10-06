import { BlockList, isIPv4, isIPv6 } from 'node:net'

/** Loopback, link-local and private ranges: where the web container's nginx can be. */
const PRIVATE_NETWORKS = new BlockList()
PRIVATE_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4')
PRIVATE_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4')
PRIVATE_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4')
PRIVATE_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4')
PRIVATE_NETWORKS.addSubnet('169.254.0.0', 16, 'ipv4')
PRIVATE_NETWORKS.addAddress('::1', 'ipv6')
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6')
PRIVATE_NETWORKS.addSubnet('fe80::', 10, 'ipv6')

/** `::ffff:172.20.0.4`, how Node reports an IPv4 peer on a dual-stack socket. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

export const isPrivateAddress = (address: string): boolean => {
  const ipv4 = IPV4_MAPPED.exec(address)?.[1] ?? (isIPv4(address) ? address : undefined)
  if (ipv4 !== undefined) return isIPv4(ipv4) && PRIVATE_NETWORKS.check(ipv4, 'ipv4')
  return isIPv6(address) && PRIVATE_NETWORKS.check(address, 'ipv6')
}

/**
 * Express `trust proxy`: which hops of `X-Forwarded-For` / `-Proto` to believe. Only the direct
 * peer (hop 0), and only when it is on a private network: that is the web container's nginx,
 * which appends the address it saw. Everything left of that entry was written by the client, so
 * a forged `X-Forwarded-For` can't buy a fresh login throttle bucket.
 */
export const trustProxy = (address: string, hop: number): boolean =>
  hop === 0 && isPrivateAddress(address)

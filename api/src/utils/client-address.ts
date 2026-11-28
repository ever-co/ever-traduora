import { isIPv4, isIPv6 } from 'node:net';

/**
 * The bucket of a client address for the rate limits (DESIGN §3.8): an IPv4 address as it is (an IPv4-mapped IPv6
 * address, `::ffff:0:0/96` in any spelling, dotted or hexadecimal, as its IPv4), an IPv6 address by its /64 prefix,
 * since one subscriber usually gets a whole /64 and could otherwise take a new bucket for every request. Anything else
 * (a missing or odd address) as it is.
 */
export function addressBucket(address: string | undefined | null): string {
  if (!address) {
    return 'unknown';
  }
  if (isIPv4(address) || !isIPv6(address.split('%')[0])) {
    return address;
  }
  const groups = expandIPv6(address);
  // IPv4-mapped (::ffff:0:0/96): its last 32 bits are the IPv4 address, however the address was written
  if (groups.slice(0, 5).every(group => group === '0') && groups[5] === 'ffff') {
    const [high, low] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
    return [Math.floor(high / 256), high % 256, Math.floor(low / 256), low % 256].join('.');
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** The eight groups of an IPv6 address, in lower-case hexadecimal without leading zeros. */
function expandIPv6(address: string): string[] {
  let text = address.split('%')[0].toLowerCase();
  // An IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is two groups
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest === undefined ? [] : rest ? rest.split(':') : [];
  const groups = rest === undefined ? headGroups : [...headGroups, ...Array(8 - headGroups.length - restGroups.length).fill('0'), ...restGroups];
  return groups.map(group => parseInt(group, 16).toString(16));
}

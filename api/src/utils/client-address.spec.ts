import { addressBucket } from './client-address';

describe('addressBucket', () => {
  it('keeps an IPv4 address, also one mapped into IPv6, in every spelling of ::ffff:0:0/96', () => {
    expect(addressBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::FFFF:127.0.0.1')).toBe('127.0.0.1');
    // Hexadecimal and fully written forms (bot review of #679): not one shared ::/64 bucket for all of them
    expect(addressBucket('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(addressBucket('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
    expect(addressBucket('0000:0000:0000:0000:0000:FFFF:CB00:7107')).toBe('203.0.113.7');
    expect(addressBucket('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::ffff:0:0')).toBe('0.0.0.0');
    expect(addressBucket('::ffff:c000:221')).toBe('192.0.2.33');
    // Not mapped: an ordinary IPv6 address, by its /64
    expect(addressBucket('::cb00:7107')).toBe('0:0:0:0::/64');
    expect(addressBucket('::fffe:cb00:7107')).toBe('0:0:0:0::/64');
  });

  it('puts an IPv6 address in its /64, however it is written', () => {
    expect(addressBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:0db8:0001:0002:ffff:eeee:dddd:cccc')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:DB8:1:2:0:0:0:9')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressBucket('2001:db8:1:3::1')).not.toBe(addressBucket('2001:db8:1:2::1'));
    expect(addressBucket('::1')).toBe('0:0:0:0::/64');
    expect(addressBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(addressBucket('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('keeps anything else as it is', () => {
    expect(addressBucket(undefined)).toBe('unknown');
    expect(addressBucket('')).toBe('unknown');
    expect(addressBucket('not an address')).toBe('not an address');
  });
});

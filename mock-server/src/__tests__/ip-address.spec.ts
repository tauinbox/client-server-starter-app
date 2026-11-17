import { normalizeIpAddress } from '../utils/ip-address';

describe('normalizeIpAddress', () => {
  it.each([
    ['2001:DB8::1', '2001:db8::1'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['127.1', '127.0.0.1'],
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::ffff:10.0.0.1', '10.0.0.1']
  ])('writes %s as the server does: %s', (ip, expected) => {
    expect(normalizeIpAddress(ip)).toBe(expected);
  });

  it('returns null for an absent or invalid address', () => {
    expect(normalizeIpAddress(undefined)).toBeNull();
    expect(normalizeIpAddress('not-an-ip')).toBeNull();
  });
});

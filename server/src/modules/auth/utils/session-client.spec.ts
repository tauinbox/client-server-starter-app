import { normalizeIpAddress, sessionClientOf } from './session-client';

describe('normalizeIpAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1']
  ])('keeps %p as %p', (input, expected) => {
    expect(normalizeIpAddress(input)).toBe(expected);
  });

  it.each([undefined, '', 'not-an-ip'])('returns null for %p', (input) => {
    expect(normalizeIpAddress(input)).toBeNull();
  });
});

describe('sessionClientOf', () => {
  it('reads the User-Agent and the address of the request', () => {
    expect(
      sessionClientOf({
        ip: '::ffff:198.51.100.4',
        headers: { 'user-agent': ' Mozilla/5.0 ' }
      })
    ).toEqual({ userAgent: 'Mozilla/5.0', ipAddress: '198.51.100.4' });
  });
});

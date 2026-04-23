import { parseTrustedProxies } from './trust-proxy.util';

describe('parseTrustedProxies', () => {
  it('returns undefined for undefined input', () => {
    expect(parseTrustedProxies(undefined)).toBeUndefined();
  });

  it('returns undefined for empty / whitespace input', () => {
    expect(parseTrustedProxies('')).toBeUndefined();
    expect(parseTrustedProxies('   ')).toBeUndefined();
  });

  it('coerces "true" / "false" to booleans', () => {
    expect(parseTrustedProxies('true')).toBe(true);
    expect(parseTrustedProxies('false')).toBe(false);
  });

  it('coerces pure digit strings to a hop count', () => {
    expect(parseTrustedProxies('1')).toBe(1);
    expect(parseTrustedProxies('42')).toBe(42);
  });

  it('passes named groups through as-is', () => {
    expect(parseTrustedProxies('loopback')).toBe('loopback');
    expect(parseTrustedProxies('linklocal')).toBe('linklocal');
    expect(parseTrustedProxies('uniquelocal')).toBe('uniquelocal');
  });

  it('passes CIDR and IP lists through as-is', () => {
    expect(parseTrustedProxies('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustedProxies('10.0.0.1,10.0.0.2')).toBe('10.0.0.1,10.0.0.2');
  });

  it('trims surrounding whitespace', () => {
    expect(parseTrustedProxies('  loopback  ')).toBe('loopback');
    expect(parseTrustedProxies('\ttrue\n')).toBe(true);
  });
});

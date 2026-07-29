import { validateClientUrl } from './client-url.provider';

describe('validateClientUrl', () => {
  it('returns the url when it is a valid http(s) url', () => {
    expect(validateClientUrl('https://app.example.com')).toBe(
      'https://app.example.com'
    );
  });

  it('rejects a missing value', () => {
    expect(() => validateClientUrl(undefined)).toThrow(
      'CLIENT_URL environment variable is not configured'
    );
  });

  it('rejects a non-http protocol', () => {
    expect(() => validateClientUrl('ftp://app.example.com')).toThrow(
      'CLIENT_URL must use http or https protocol, got: ftp:'
    );
  });

  it('rejects a malformed url', () => {
    expect(() => validateClientUrl('not-a-url')).toThrow(
      'CLIENT_URL is not a valid URL: not-a-url'
    );
  });
});

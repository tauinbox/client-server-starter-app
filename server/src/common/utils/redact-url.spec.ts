import { redactSensitiveQuery } from '@app/shared/utils/redact-url';

describe('redactSensitiveQuery', () => {
  it('replaces the OAuth authorization code and state', () => {
    expect(
      redactSensitiveQuery(
        '/api/v1/auth/oauth/google/callback?state=abc123&code=4%2F0AfJohX&scope=email'
      )
    ).toBe(
      '/api/v1/auth/oauth/google/callback?state=REDACTED&code=REDACTED&scope=email'
    );
  });

  it('replaces a token parameter whatever its case', () => {
    expect(redactSensitiveQuery('/x?Token=secret')).toBe('/x?Token=REDACTED');
  });

  it('collapses a repeated sensitive parameter into one redacted value', () => {
    expect(redactSensitiveQuery('/x?code=a&code=b')).toBe('/x?code=REDACTED');
  });

  it('returns a URL with no sensitive parameter unchanged, encoding included', () => {
    const url = '/api/v1/users/cursor?q=a%20b&limit=20';
    expect(redactSensitiveQuery(url)).toBe(url);
  });

  it('returns a URL without a query string unchanged', () => {
    expect(redactSensitiveQuery('/api/v1/auth/login')).toBe(
      '/api/v1/auth/login'
    );
  });
});

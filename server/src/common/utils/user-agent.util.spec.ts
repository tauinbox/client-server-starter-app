import { MAX_USER_AGENT_LENGTH, normalizeUserAgent } from './user-agent.util';

describe('normalizeUserAgent', () => {
  it('keeps an ordinary header as it is', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0';
    expect(normalizeUserAgent(ua)).toBe(ua);
  });

  it('stores an absent or blank header as null', () => {
    expect(normalizeUserAgent(undefined)).toBeNull();
    expect(normalizeUserAgent('')).toBeNull();
    expect(normalizeUserAgent('   ')).toBeNull();
  });

  it('drops control characters', () => {
    expect(normalizeUserAgent('Agent\u0000/1\r\n\u007f\u0085')).toBe('Agent/1');
  });

  it('cuts the value to the column width', () => {
    const result = normalizeUserAgent('a'.repeat(MAX_USER_AGENT_LENGTH + 50));
    expect(result).toHaveLength(MAX_USER_AGENT_LENGTH);
  });

  it('reads the first value of a repeated header', () => {
    expect(normalizeUserAgent(['First/1', 'Second/2'])).toBe('First/1');
  });
});

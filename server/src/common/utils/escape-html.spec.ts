import { escapeHtml, maskEmail } from './escape-html';

describe('escapeHtml', () => {
  it('escapes the five OWASP characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('maskEmail', () => {
  it.each([
    ['alice@example.com', 'a***e@example.com'],
    ['al@example.com', 'a***l@example.com'],
    ['a@example.com', 'a***@example.com'],
    ['no-at-sign', 'no-at-sign'],
    ['@example.com', '@example.com']
  ])('masks %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

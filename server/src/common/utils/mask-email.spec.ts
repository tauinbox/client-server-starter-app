import { maskEmail } from './mask-email';

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

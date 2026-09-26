import { issuedBeforeRevocation } from '@app/shared/utils/token-revocation';

describe('issuedBeforeRevocation', () => {
  const iat = 1_700_000_000;

  it('accepts any token when the account was never revoked', () => {
    expect(issuedBeforeRevocation(iat, null)).toBe(false);
  });

  it('accepts a token minted in the second of the revocation', () => {
    // Whole-second `iat` cannot tell "before" from "after" inside that second.
    expect(issuedBeforeRevocation(iat, new Date(iat * 1000 + 700))).toBe(false);
  });

  it('refuses a token minted in the second before the revocation', () => {
    expect(issuedBeforeRevocation(iat - 1, new Date(iat * 1000 + 700))).toBe(
      true
    );
  });

  it('reads the ISO string the mock stores like a Date', () => {
    const revokedAt = new Date(iat * 1000 + 700).toISOString();
    expect(issuedBeforeRevocation(iat, revokedAt)).toBe(false);
    expect(issuedBeforeRevocation(iat - 1, revokedAt)).toBe(true);
  });
});

import {
  accountRefusal,
  issuedBeforeRevocation,
  stampedBeforeRevocation,
  signedTokenAccount
} from '@app/shared/utils/token-revocation';

describe('accountRefusal', () => {
  it.each([null, undefined])('refuses a missing account (%s)', (user) => {
    expect(accountRefusal(user)).toEqual({ refusal: 'account_not_found' });
  });

  it('refuses a deactivated account', () => {
    expect(accountRefusal({ isActive: false })).toEqual({
      refusal: 'account_deactivated'
    });
  });

  it('accepts an active account', () => {
    const user = { isActive: true };

    expect(accountRefusal(user)).toEqual({ user });
  });
});

describe('issuedBeforeRevocation', () => {
  const iat = 1_700_000_000;

  it('accepts any token when the account was never revoked', () => {
    expect(issuedBeforeRevocation(iat, null)).toBe(false);
  });

  it('accepts an access token minted in the second of the revocation', () => {
    // Whole-second `iat` cannot tell "before" from "after" inside that second.
    // The session check of the access token refuses the "before" case.
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

describe('stampedBeforeRevocation', () => {
  const startedAt = new Date('2026-11-08T07:55:01.407Z');

  it('keeps any session when the account was never revoked', () => {
    expect(stampedBeforeRevocation(startedAt, null)).toBe(false);
  });

  it('ends a session that started one millisecond before the revocation', () => {
    // No floor: a row that a sign-in commits after the revocation is this case.
    expect(
      stampedBeforeRevocation(startedAt, new Date(startedAt.getTime() + 1))
    ).toBe(true);
  });

  it('keeps a session that started at or after the revocation', () => {
    expect(stampedBeforeRevocation(startedAt, startedAt)).toBe(false);
    expect(
      stampedBeforeRevocation(startedAt, new Date(startedAt.getTime() - 1))
    ).toBe(false);
  });

  it('reads the epoch milliseconds and the ISO string of the mock', () => {
    const revokedAt = new Date(startedAt.getTime() + 1).toISOString();

    expect(stampedBeforeRevocation(startedAt.getTime(), revokedAt)).toBe(true);
  });
});

describe('signedTokenAccount', () => {
  // Epoch milliseconds, in the middle of a second.
  const issuedAtMs = Date.parse('2026-11-08T07:55:01.500Z');
  const revokedLater = new Date(issuedAtMs + 5000);
  const active = (tokenRevokedAt: Date | string | null) => ({
    isActive: true,
    tokenRevokedAt
  });

  it('returns an active account that was never revoked', () => {
    const user = active(null);

    expect(signedTokenAccount(user, issuedAtMs)).toEqual({ user });
  });

  it('names a missing account', () => {
    expect(signedTokenAccount(null, issuedAtMs)).toEqual({
      refusal: 'account_not_found'
    });
  });

  it('names a deactivated account before a revocation', () => {
    expect(
      signedTokenAccount(
        { isActive: false, tokenRevokedAt: revokedLater },
        issuedAtMs
      )
    ).toEqual({ refusal: 'account_deactivated' });
  });

  it('names a token minted before the revocation', () => {
    expect(signedTokenAccount(active(revokedLater), issuedAtMs)).toEqual({
      refusal: 'session_revoked'
    });
  });

  // Regression: no session guards these tokens, so a whole-second floor let a
  // token minted earlier in the second of a sign-out everywhere sign in.
  it('names a token minted earlier in the second of the revocation', () => {
    expect(
      signedTokenAccount(active(new Date(issuedAtMs + 200)), issuedAtMs)
    ).toEqual({ refusal: 'session_revoked' });
  });

  it('accepts a token minted later in the second of the revocation', () => {
    const user = active(new Date(issuedAtMs - 200));

    expect(signedTokenAccount(user, issuedAtMs)).toEqual({ user });
  });

  it('reads the ISO string the mock stores like a Date', () => {
    expect(
      signedTokenAccount(
        active(new Date(issuedAtMs + 200).toISOString()),
        issuedAtMs
      )
    ).toEqual({ refusal: 'session_revoked' });
  });
});

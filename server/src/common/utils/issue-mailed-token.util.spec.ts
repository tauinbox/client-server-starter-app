import { issueMailedToken } from './issue-mailed-token.util';
import { hashToken } from './hash-token';

describe('issueMailedToken', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues 32 random bytes as hex and keeps only their hash', () => {
    const issued = issueMailedToken(60_000);

    expect(issued.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.hashedToken).toBe(hashToken(issued.rawToken));
  });

  it('expires after the given period', () => {
    jest.useFakeTimers({ now: 1_000_000 });

    expect(issueMailedToken(3_600_000).expiresAt.getTime()).toBe(4_600_000);
  });

  it('issues a different token on each call', () => {
    expect(issueMailedToken(1).rawToken).not.toBe(issueMailedToken(1).rawToken);
  });
});

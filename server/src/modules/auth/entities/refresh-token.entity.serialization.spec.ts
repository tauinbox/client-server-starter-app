import { instanceToPlain } from 'class-transformer';
import { RefreshToken } from './refresh-token.entity';

function createRefreshToken(
  overrides: Partial<RefreshToken> = {}
): RefreshToken {
  return Object.assign(new RefreshToken(), {
    id: 'rt-1',
    token: 'hashed-secret-value',
    userId: 'user-1',
    expiresAt: new Date('2026-01-02T00:00:00Z'),
    revoked: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  });
}

describe('RefreshToken entity serialization', () => {
  it('hides the token hash', () => {
    const plain = instanceToPlain(createRefreshToken());
    expect(plain).not.toHaveProperty('token');
  });

  it('keeps the session bookkeeping fields', () => {
    const plain = instanceToPlain(createRefreshToken());
    expect(plain).toMatchObject({
      id: 'rt-1',
      userId: 'user-1',
      revoked: false
    });
  });
});

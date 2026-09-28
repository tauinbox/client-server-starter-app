import { HttpStatus } from '@nestjs/common';
import { lockedException } from './locked-exception';

describe('lockedException', () => {
  const now = new Date('2026-01-01T00:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers 423 with the lock end and the seconds left', () => {
    const lockedUntil = new Date(now + 90_500);

    const exception = lockedException('Locked', 'errors.auth.x', lockedUntil);

    expect(exception.getStatus()).toBe(HttpStatus.LOCKED);
    expect(exception.getResponse()).toEqual({
      message: 'Locked',
      errorKey: 'errors.auth.x',
      lockedUntil: lockedUntil.toISOString(),
      retryAfter: 91
    });
  });

  it('never asks the caller to wait less than one second', () => {
    const exception = lockedException(
      'Locked',
      'errors.auth.x',
      new Date(now - 5)
    );

    expect(exception.getResponse()).toMatchObject({ retryAfter: 1 });
  });
});

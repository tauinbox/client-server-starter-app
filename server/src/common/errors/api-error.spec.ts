import { HttpException } from '@nestjs/common';
import {
  ERROR_STATUS,
  ErrorKeys,
  type ErrorKey,
  type ErrorStatus
} from '@app/shared/constants';
import { ApiError } from './api-error';

describe('ApiError', () => {
  it('answers the status that ERROR_STATUS gives the key', () => {
    const error = new ApiError(ErrorKeys.ROLES.NAME_EXISTS, 'Taken');

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.errorKey).toBe(ErrorKeys.ROLES.NAME_EXISTS);
    expect(error.getResponse()).toEqual({
      message: 'Taken',
      errorKey: ErrorKeys.ROLES.NAME_EXISTS
    });
  });

  it('adds the extra fields, and the key and the message win over them', () => {
    const error = new ApiError(ErrorKeys.AUTH.ACCOUNT_LOCKED, 'Locked', {
      retryAfter: 5,
      message: 'ignored',
      errorKey: 'ignored'
    });

    expect(error.getResponse()).toEqual({
      retryAfter: 5,
      message: 'Locked',
      errorKey: ErrorKeys.AUTH.ACCOUNT_LOCKED
    });
  });

  it('keeps the cause', () => {
    const cause = new Error('socket hang up');
    const error = new ApiError(
      ErrorKeys.BILLING.PROVIDER_ERROR,
      'failed',
      {},
      { cause }
    );

    expect(error.cause).toBe(cause);
  });

  it('gives every key a status', () => {
    const keys = Object.values(ErrorKeys).flatMap((group) =>
      Object.values(group)
    );
    for (const key of keys) {
      expect(ERROR_STATUS[key]).toEqual(expect.any(Number));
    }
    expect(Object.keys(ERROR_STATUS)).toHaveLength(keys.length);
  });

  it('refuses a table with a key left out at compile time', () => {
    // @ts-expect-error a key with no status does not compile
    const partial: Record<ErrorKey, ErrorStatus> = {
      [ErrorKeys.AUTH.INVALID_CREDENTIALS]: 401
    };
    expect(partial).toBeDefined();
  });
});

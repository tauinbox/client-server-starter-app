import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './is-unique-violation.util';

describe('isUniqueViolation', () => {
  it('detects the code on a raw driver error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('detects the code on a wrapped QueryFailedError', () => {
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505'
    });
    const error = new QueryFailedError('INSERT ...', [], driverError);

    expect(isUniqueViolation(error)).toBe(true);
  });

  it('rejects other PostgreSQL error codes', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ driverError: { code: '23502' } })).toBe(false);
  });

  it('rejects errors carrying no code at all', () => {
    expect(isUniqueViolation(new Error('connection lost'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

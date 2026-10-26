import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import {
  addressTakenWhere,
  emailExistsConflict,
  isEmailExistsConflict
} from './email-taken';

describe('email-taken', () => {
  it('treats the address as taken when it is an email or a pending email', () => {
    expect(addressTakenWhere('a@example.com')).toEqual([
      { email: 'a@example.com' },
      { pendingEmail: 'a@example.com' }
    ]);
  });

  it('answers 409 with the email-exists key', () => {
    const exception = emailExistsConflict();

    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.getResponse()).toEqual({
      message: 'User with this email already exists',
      errorKey: ErrorKeys.USERS.EMAIL_EXISTS
    });
  });

  it('recognizes only the email-exists conflict', () => {
    expect(isEmailExistsConflict(emailExistsConflict())).toBe(true);
    expect(isEmailExistsConflict(new ConflictException('other'))).toBe(false);
    expect(
      isEmailExistsConflict(
        new HttpException({ errorKey: 'errors.other' }, HttpStatus.CONFLICT)
      )
    ).toBe(false);
    expect(isEmailExistsConflict(new Error('x'))).toBe(false);
  });
});

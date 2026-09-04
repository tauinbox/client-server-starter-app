import { isEmail } from 'class-validator';
import { EMAIL_ADDRESS_CORPUS } from '@app/shared/test-fixtures/email-address-corpus';

/*
 * `@IsEmail()` is the address check on every DTO that carries an address
 * (`forgot-password`, `initiate-email-change`, `login`, `resend-verification`
 * and `create-user`), and it calls this same `isEmail` function with the
 * default options.
 *
 * The mock server cannot import the implementation, so it calls validator.js
 * itself. This spec and its twin in `mock-server/` run the identical corpus, so
 * a validator.js release that moves a verdict in one workspace fails there
 * instead of splitting the two backends without a sound.
 */
describe('@IsEmail() over the shared address corpus', () => {
  it.each(
    EMAIL_ADDRESS_CORPUS.map(
      (entry) => [entry.reason, entry.address, entry.valid] as const
    )
  )('%s', (_reason, address, valid) => {
    expect(isEmail(address)).toBe(valid);
  });

  it('refuses every non-string value, as the decorator does', () => {
    expect(isEmail(undefined)).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail(42)).toBe(false);
  });
});

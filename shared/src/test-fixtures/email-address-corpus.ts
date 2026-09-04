/**
 * The address corpus that the server and the mock server must agree on.
 *
 * The server validates every address field with `@IsEmail()`, which calls
 * `validator.isEmail` with the default options. The mock server calls the same
 * function directly, because a bare specifier inside `shared/src` has no
 * `node_modules` to resolve from when the client Playwright fixture loads the
 * mock in process - the same constraint that keeps `temporal-polyfill` out of
 * `shared/src/utils/time.ts` for the mock.
 *
 * The implementation therefore cannot be shared, but the contract can. Each
 * workspace runs this corpus against its own copy of the validator, so a
 * version that changes a verdict fails a test instead of splitting the two
 * backends in silence.
 *
 * The `\u` escapes hold a Cyrillic local part and domain. The source file stays
 * ASCII.
 */
export interface EmailAddressCase {
  /** The raw address, already in the normalized (trimmed, lowercased) form. */
  readonly address: string;
  /** The verdict both backends must return. */
  readonly valid: boolean;
  /** Why the address is in the corpus. */
  readonly reason: string;
}

const OVER_LONG_LOCAL_PART = `${'a'.repeat(65)}@example.com`;
const LONG_LOCAL_PART_UNDER_THE_ADDRESS_CAP = `${'a'.repeat(188)}@example.com`;
const OVER_LONG_DOMAIN_LABEL = `user@${'b'.repeat(64)}.com`;

export const EMAIL_ADDRESS_CORPUS: readonly EmailAddressCase[] = [
  { address: 'user@example.com', valid: true, reason: 'plain address' },
  {
    address: '"quoted"@example.com',
    valid: true,
    reason: 'quoted local part'
  },
  { address: 'user+tag@example.com', valid: true, reason: 'plus tag' },
  {
    address: 'user@localhost.localdomain',
    valid: true,
    reason: 'domain with no public suffix'
  },
  {
    address:
      '\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c@\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444',
    valid: true,
    reason: 'non-ASCII local part and domain'
  },
  {
    address: 'user@example.',
    valid: false,
    reason: 'empty last label, rejected by both sides before the fix'
  },
  {
    address: 'user@exa mple.com',
    valid: false,
    reason: 'space in the domain, rejected by both sides before the fix'
  },
  {
    address: OVER_LONG_LOCAL_PART,
    valid: false,
    reason: 'local part over 64 characters'
  },
  {
    address: LONG_LOCAL_PART_UNDER_THE_ADDRESS_CAP,
    valid: false,
    reason: 'local part over 64 characters, address under the 255 cap'
  },
  {
    address: OVER_LONG_DOMAIN_LABEL,
    valid: false,
    reason: 'domain label over 63 characters'
  },
  {
    address: 'user@-example.com',
    valid: false,
    reason: 'domain label starts with a hyphen'
  },
  {
    address: 'user@example-.com',
    valid: false,
    reason: 'domain label ends with a hyphen'
  },
  { address: 'user@.example.com', valid: false, reason: 'empty first label' },
  { address: 'user@example..com', valid: false, reason: 'empty middle label' },
  {
    address: '.user@example.com',
    valid: false,
    reason: 'local part starts with a dot'
  },
  {
    address: 'user.@example.com',
    valid: false,
    reason: 'local part ends with a dot'
  },
  {
    address: 'us..er@example.com',
    valid: false,
    reason: 'two dots in the local part'
  },
  {
    address: 'user@exam_ple.com',
    valid: false,
    reason: 'underscore in the domain'
  },
  {
    address: 'user@example.c',
    valid: false,
    reason: 'single-character last label'
  },
  {
    address: 'user@[127.0.0.1]',
    valid: false,
    reason: 'address literal, off in the default options'
  }
];

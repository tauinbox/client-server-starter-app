import {
  exceedsPasswordByteLimit,
  passwordByteLength,
  passwordByteLimitMessage
} from '@app/shared/utils/password-bytes';
import { MAX_NEW_PASSWORD_BYTES } from '@app/shared/constants';

// 'Parol1' written in Cyrillic, then 30 more Cyrillic letters: 37 characters
// and 73 bytes. This is the case a character-based check accepts and bcrypt
// then truncates.
const CYRILLIC_73_BYTES = 'Пароль1' + 'я'.repeat(30);

describe('password byte limit', () => {
  describe('passwordByteLength', () => {
    it('counts one byte per ASCII character', () => {
      expect(passwordByteLength('a'.repeat(72))).toBe(72);
    });

    it('counts two bytes per Cyrillic character', () => {
      expect(CYRILLIC_73_BYTES).toHaveLength(37);
      expect(passwordByteLength(CYRILLIC_73_BYTES)).toBe(73);
    });
  });

  describe('exceedsPasswordByteLimit', () => {
    it('accepts exactly the limit', () => {
      expect(exceedsPasswordByteLimit('a'.repeat(MAX_NEW_PASSWORD_BYTES))).toBe(
        false
      );
    });

    it('rejects one byte over the limit', () => {
      expect(
        exceedsPasswordByteLimit('a'.repeat(MAX_NEW_PASSWORD_BYTES + 1))
      ).toBe(true);
    });

    it('rejects a 37-character Cyrillic password', () => {
      expect(exceedsPasswordByteLimit(CYRILLIC_73_BYTES)).toBe(true);
    });

    it('leaves a non-string to the type validators', () => {
      expect(exceedsPasswordByteLimit(undefined)).toBe(false);
      expect(exceedsPasswordByteLimit(12345678)).toBe(false);
    });
  });

  describe('passwordByteLimitMessage', () => {
    it('names the field and the byte limit', () => {
      expect(passwordByteLimitMessage('password')).toBe(
        'password is too long: some characters count as more than one byte, ' +
          `so it must be at most ${MAX_NEW_PASSWORD_BYTES} bytes`
      );
    });
  });
});

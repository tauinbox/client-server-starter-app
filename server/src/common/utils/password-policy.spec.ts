import { localPasswordRefusal } from '@app/shared/utils/password-policy';
import { COMMON_PASSWORDS } from '@app/shared/data/common-passwords';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_PRODUCT_WORDS
} from '@app/shared/constants';

const CONTEXT = {
  email: 'john.smith@example.com',
  firstName: 'Martina',
  lastName: 'Rossi'
};

describe('localPasswordRefusal', () => {
  describe('common list', () => {
    it('holds at least the 3000 entries ASVS 6.2.4 asks for, all policy-length', () => {
      expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(3000);
      for (const entry of COMMON_PASSWORDS) {
        expect(entry.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
        expect(entry).toBe(entry.toLowerCase());
      }
    });

    it('refuses a listed password whatever its case', () => {
      expect(localPasswordRefusal('Password123', {})).toBe('common');
      expect(localPasswordRefusal('QWERTY123456', {})).toBe('common');
    });

    it('refuses an entry of the Russian source list', () => {
      // `1q2w3e4r5t` heads the Russian list at the pinned commit.
      expect(localPasswordRefusal('1q2w3e4r5t', {})).toBe('common');
    });
  });

  describe('context words', () => {
    it('refuses the product name', () => {
      expect(PASSWORD_PRODUCT_WORDS).toContain('nexus');
      expect(localPasswordRefusal('MyNexus-Kettle-19', {})).toBe('context');
    });

    it('refuses the whole email local part and each of its words', () => {
      expect(localPasswordRefusal('xx-john.smith-19', CONTEXT)).toBe('context');
      expect(localPasswordRefusal('Kettle-Smith-19', CONTEXT)).toBe('context');
      expect(localPasswordRefusal('Kettle-John-19', CONTEXT)).toBe('context');
    });

    it('refuses the first and the last name, case-insensitively', () => {
      expect(localPasswordRefusal('Kettle-MARTINA-19', CONTEXT)).toBe(
        'context'
      );
      expect(localPasswordRefusal('Kettle-rossi-19', CONTEXT)).toBe('context');
    });

    it('refuses a Cyrillic name', () => {
      expect(
        localPasswordRefusal('Чайник-Мартина-19', { firstName: 'Мартина' })
      ).toBe('context');
    });

    it('ignores a context word shorter than four characters', () => {
      expect(
        localPasswordRefusal('Kettle-Ann-Sunrise', { firstName: 'Ann' })
      ).toBeNull();
    });

    it('ignores the email domain', () => {
      expect(
        localPasswordRefusal('Kettle-Example-19', {
          email: 'john.smith@example.com'
        })
      ).toBeNull();
    });
  });

  it('accepts a password that is neither listed nor built from context', () => {
    expect(localPasswordRefusal('Sunrise-Kettle-19', CONTEXT)).toBeNull();
  });

  it('accepts null context fields', () => {
    expect(
      localPasswordRefusal('Sunrise-Kettle-19', {
        email: null,
        firstName: null,
        lastName: null
      })
    ).toBeNull();
  });
});

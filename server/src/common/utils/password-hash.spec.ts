import * as bcrypt from 'bcrypt';
import {
  hashPassword,
  PasswordHashVersion,
  prehashPassword,
  verifyPassword
} from './password-hash';

// bcrypt at its minimum cost: these tests check the format, not the cost.
jest.setTimeout(30000);

describe('password-hash', () => {
  // A UTF-8 Cyrillic letter is two bytes: 128 bytes, past what bcrypt reads.
  const CYRILLIC_64 = 'Пароль1' + 'я'.repeat(57);
  // Two values that share their first 72 bytes and differ after them.
  const PREFIX_72 = 'A1' + 'a'.repeat(70);
  const LONG_B = PREFIX_72 + 'b';
  const LONG_C = PREFIX_72 + 'c';

  describe('prehashPassword', () => {
    it('returns 44 base64 characters with no NUL byte', () => {
      const value = prehashPassword(CYRILLIC_64);

      expect(value).toHaveLength(44);
      expect(value).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    });

    it('differs for values that share a 72-byte prefix', () => {
      expect(prehashPassword(LONG_B)).not.toBe(prehashPassword(LONG_C));
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('stores the current version and verifies 64 Cyrillic characters', async () => {
      const { hash, version } = await hashPassword(CYRILLIC_64);

      expect(version).toBe(PasswordHashVersion.PREHASHED);
      await expect(verifyPassword(CYRILLIC_64, hash, version)).resolves.toEqual(
        { valid: true, upgrade: false }
      );
    });

    it('rejects a wrong password', async () => {
      const { hash, version } = await hashPassword(CYRILLIC_64);

      await expect(
        verifyPassword(CYRILLIC_64 + 'x', hash, version)
      ).resolves.toEqual({ valid: false, upgrade: false });
    });

    it('does not let a value open a hash that shares only its 72-byte prefix', async () => {
      const { hash, version } = await hashPassword(LONG_B);

      expect((await verifyPassword(LONG_C, hash, version)).valid).toBe(false);
    });

    it('verifies a legacy hash over the raw value and asks for an upgrade', async () => {
      const legacy = await bcrypt.hash(PREFIX_72, 4);

      await expect(
        verifyPassword(PREFIX_72, legacy, PasswordHashVersion.LEGACY)
      ).resolves.toEqual({ valid: true, upgrade: true });
    });

    it('does not ask for an upgrade when a legacy hash does not match', async () => {
      const legacy = await bcrypt.hash(PREFIX_72, 4);

      await expect(
        verifyPassword('wrong-password', legacy, PasswordHashVersion.LEGACY)
      ).resolves.toEqual({ valid: false, upgrade: false });
    });

    it('does not verify a legacy hash as a current one', async () => {
      const legacy = await bcrypt.hash(PREFIX_72, 4);

      expect(
        (await verifyPassword(PREFIX_72, legacy, PasswordHashVersion.PREHASHED))
          .valid
      ).toBe(false);
    });
  });
});

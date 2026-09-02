import { randomBytes } from 'crypto';
import { createMockConfigService } from '../testing/config-service.mock';
import {
  SecretEncryptionService,
  digestsMatch
} from './secret-encryption.service';

function serviceWithKey(key: string | undefined): SecretEncryptionService {
  return new SecretEncryptionService(
    createMockConfigService({ MFA_ENCRYPTION_KEY: key ?? '' })
  );
}

const VALID_KEY = randomBytes(32).toString('base64');

describe('SecretEncryptionService', () => {
  describe('configuration', () => {
    it('reports itself configured with a 32 byte key', () => {
      expect(serviceWithKey(VALID_KEY).isConfigured).toBe(true);
    });

    it('reports itself unconfigured with no key', () => {
      expect(serviceWithKey(undefined).isConfigured).toBe(false);
      expect(serviceWithKey('').isConfigured).toBe(false);
    });

    it('refuses to start with a key of the wrong length', () => {
      expect(() => serviceWithKey(randomBytes(16).toString('base64'))).toThrow(
        /32 bytes/
      );
    });

    it('refuses to encrypt without a key, rather than storing clear text', () => {
      expect(() => serviceWithKey(undefined).encrypt('secret')).toThrow(
        /not configured/
      );
    });
  });

  describe('round trip', () => {
    const service = serviceWithKey(VALID_KEY);

    it('returns the original value', () => {
      expect(service.decrypt(service.encrypt('JBSWY3DPEHPK3PXP'))).toBe(
        'JBSWY3DPEHPK3PXP'
      );
    });

    it('never puts the plain text in the stored payload', () => {
      const payload = service.encrypt('JBSWY3DPEHPK3PXP');

      expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
      expect(payload.startsWith('v1.')).toBe(true);
      expect(payload.split('.')).toHaveLength(4);
    });

    it('produces a different payload every time for the same input', () => {
      // A fixed IV would let anyone holding the column tell two accounts with
      // the same secret apart, and would break GCM outright.
      expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
    });

    it('handles a value with characters outside ASCII', () => {
      expect(service.decrypt(service.encrypt('секрет'))).toBe('секрет');
    });
  });

  describe('rejection', () => {
    const service = serviceWithKey(VALID_KEY);

    it('refuses a payload whose ciphertext was altered', () => {
      const payload = service.encrypt('JBSWY3DPEHPK3PXP');
      const parts = payload.split('.');
      const flipped = Buffer.from(parts[3], 'base64url');
      flipped[0] = flipped[0] ^ 0xff;
      parts[3] = flipped.toString('base64url');

      expect(() => service.decrypt(parts.join('.'))).toThrow();
    });

    it('refuses a payload with an unknown version prefix', () => {
      const payload = service.encrypt('JBSWY3DPEHPK3PXP');

      expect(() => service.decrypt(payload.replace('v1.', 'v2.'))).toThrow(
        /malformed/
      );
    });

    it('refuses a payload with the wrong number of parts', () => {
      expect(() => service.decrypt('v1.aaa.bbb')).toThrow(/malformed/);
    });

    it('refuses a payload whose parts are the wrong size', () => {
      expect(() => service.decrypt('v1.AAAA.BBBB.CCCC')).toThrow(/malformed/);
    });

    it('refuses a payload written under a different key', () => {
      const other = serviceWithKey(randomBytes(32).toString('base64'));

      expect(() =>
        service.decrypt(other.encrypt('JBSWY3DPEHPK3PXP'))
      ).toThrow();
    });
  });

  describe('digestsMatch', () => {
    it('matches two equal digests', () => {
      expect(digestsMatch('abcdef01', 'abcdef01')).toBe(true);
    });

    it('rejects different digests of the same length', () => {
      expect(digestsMatch('abcdef01', 'abcdef02')).toBe(false);
    });

    it('rejects digests of different lengths instead of throwing', () => {
      expect(digestsMatch('abcdef01', 'abcdef')).toBe(false);
    });
  });
});

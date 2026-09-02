import { Module } from '@nestjs/common';
import { SecretEncryptionService } from './secret-encryption.service';

/**
 * Holds the symmetric-encryption service so that more than one module can
 * inject it without providing a second instance of its own. AuthModule needs
 * it for the two-factor secret; CaslModule needs it because the enrolment
 * requirement is inert while the key is absent.
 */
@Module({
  providers: [SecretEncryptionService],
  exports: [SecretEncryptionService]
})
export class CryptoModule {}

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MfaRecoveryDto } from './mfa.dto';

/**
 * New codes carry three groups. Codes issued before the entropy rise carry
 * two, and the owner keeps them until the set is replaced, so the route must
 * accept both. These cases drive the same ValidationPipe the application
 * installs.
 */
describe('MfaRecoveryDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function transform(recoveryCode: string): Promise<unknown> {
    return await pipe.transform(
      { mfaToken: 'pending', recoveryCode },
      { type: 'body', metatype: MfaRecoveryDto }
    );
  }

  it.each([
    'ABCDEFGH-IJKLMNOP-QRSTUVWX',
    'abcdefghijklmnopqrstuvwx',
    'ABCDEFGH-IJKLMNOPQRSTUVWX',
    'ABCDEFGH-IJKLMNOP',
    'ABCDEFGHIJKLMNOP'
  ])('accepts %s', async (recoveryCode) => {
    await expect(transform(recoveryCode)).resolves.toMatchObject({
      recoveryCode
    });
  });

  it.each([
    'ABCDEFGH',
    'ABCDEFGH-IJKLMNOP-QRST',
    'ABCDEFGH-IJKLMNOP-QRSTUVWX-YZ234567',
    'ABCDEFGH-IJKLMNOP-QRSTUVW1'
  ])('rejects %s', async (recoveryCode) => {
    await expect(transform(recoveryCode)).rejects.toThrow(BadRequestException);
  });
});

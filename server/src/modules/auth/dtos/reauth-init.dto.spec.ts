import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import { ReauthInitDto } from './reauth-init.dto';

/**
 * The proof the callback mints repeats the operation this body declares, so an
 * unknown or absent value must never reach the token. These cases drive the
 * same ValidationPipe the application installs.
 */
describe('ReauthInitDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function transform(body: unknown): Promise<unknown> {
    return await pipe.transform(body, {
      type: 'body',
      metatype: ReauthInitDto
    });
  }

  it('accepts a known operation', async () => {
    await expect(
      transform({ operation: STEP_UP_OPERATION.PASSWORD_SET })
    ).resolves.toMatchObject({ operation: STEP_UP_OPERATION.PASSWORD_SET });
  });

  it('rejects an unknown operation', async () => {
    await expect(transform({ operation: 'delete_account' })).rejects.toThrow(
      BadRequestException
    );
  });

  it('rejects a body that declares no operation', async () => {
    await expect(transform({})).rejects.toThrow(BadRequestException);
  });
});

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  MAX_NEW_PASSWORD_BYTES,
  MAX_PASSWORD_LENGTH
} from '@app/shared/constants';
import { CreateUserDto } from '../../users/dtos/create-user.dto';
import { InitiateEmailChangeDto } from './initiate-email-change.dto';
import { LoginDto } from './login.dto';
import { MfaDisableDto, MfaSetupDto } from './mfa.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { UpdateProfileDto } from './update-profile.dto';

// bcrypt reads at most 72 bytes of its input, so a field whose value is hashed
// for storage caps there. A field that is only compared against a stored hash
// keeps the higher cap: the hash was computed over the same truncated prefix,
// so a lower cap on that path would lock out the owner of a long legacy
// password without making any hash safer.
describe('Password byte cap', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  // 'Parol1' written in Cyrillic, then 30 more Cyrillic letters: 37 characters
  // and 73 bytes. A character-based cap accepts it and bcrypt truncates it.
  const CYRILLIC_73_BYTES = 'Пароль1' + 'я'.repeat(30);
  const ASCII_128 = 'A1' + 'a'.repeat(126);

  async function validate(
    metatype: Type<unknown>,
    payload: unknown
  ): Promise<unknown> {
    return pipe.transform(payload, { type: 'body', metatype });
  }

  async function expectRejected(
    metatype: Type<unknown>,
    payload: unknown,
    messagePart: string
  ): Promise<void> {
    const error = await validate(metatype, payload).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    expect(response.message.join(' ')).toContain(messagePart);
  }

  const BYTE_MESSAGE =
    'password is too long: some characters count as more than one byte, ' +
    `so it must be at most ${MAX_NEW_PASSWORD_BYTES} bytes`;

  const setPaths: ReadonlyArray<
    [name: string, metatype: Type<unknown>, base: Record<string, unknown>]
  > = [
    ['ResetPasswordDto', ResetPasswordDto, { token: 'x'.repeat(64) }],
    ['UpdateProfileDto', UpdateProfileDto, {}],
    [
      'CreateUserDto',
      CreateUserDto,
      {
        email: 'new.user@example.com',
        firstName: 'New',
        lastName: 'User'
      }
    ]
  ];

  describe.each(setPaths)('%s (sets a password)', (_name, metatype, base) => {
    it('accepts a password of exactly the byte limit', async () => {
      await expect(
        validate(metatype, {
          ...base,
          password: 'A1' + 'a'.repeat(MAX_NEW_PASSWORD_BYTES - 2)
        })
      ).resolves.toBeDefined();
    });

    it('rejects a 73-byte Cyrillic password that no character cap catches', async () => {
      expect(CYRILLIC_73_BYTES).toHaveLength(37);
      await expectRejected(
        metatype,
        { ...base, password: CYRILLIC_73_BYTES },
        BYTE_MESSAGE
      );
    });

    it('rejects a 73-character ASCII password on the character cap', async () => {
      await expectRejected(
        metatype,
        { ...base, password: 'A1' + 'a'.repeat(MAX_NEW_PASSWORD_BYTES - 1) },
        `password must be shorter than or equal to ${MAX_NEW_PASSWORD_BYTES} characters`
      );
    });
  });

  const verifyPaths: ReadonlyArray<
    [name: string, metatype: Type<unknown>, payload: Record<string, unknown>]
  > = [
    ['LoginDto', LoginDto, { email: 'user@example.com', password: ASCII_128 }],
    ['UpdateProfileDto', UpdateProfileDto, { currentPassword: ASCII_128 }],
    [
      'InitiateEmailChangeDto',
      InitiateEmailChangeDto,
      { newEmail: 'new.user@example.com', currentPassword: ASCII_128 }
    ],
    ['MfaSetupDto', MfaSetupDto, { currentPassword: ASCII_128 }],
    ['MfaDisableDto', MfaDisableDto, { currentPassword: ASCII_128 }]
  ];

  // The anti-lockout regression test. A user whose stored hash came from a
  // 100-character password must still be able to submit it.
  describe.each(verifyPaths)(
    '%s (verifies a password)',
    (_name, metatype, payload) => {
      it(`still accepts a ${MAX_PASSWORD_LENGTH}-character value`, async () => {
        expect(ASCII_128).toHaveLength(MAX_PASSWORD_LENGTH);
        await expect(validate(metatype, payload)).resolves.toBeDefined();
      });
    }
  );
});

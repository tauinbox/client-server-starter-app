import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { CreateUserDto } from '../../users/dtos/create-user.dto';
import { InitiateEmailChangeDto } from './initiate-email-change.dto';
import { LoginDto } from './login.dto';
import { MfaSetupDto, MfaStepUpDto } from './mfa.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { UpdateProfileDto } from './update-profile.dto';

// The password is pre-hashed before bcrypt, so the 72 bytes bcrypt reads no
// longer limit it. Every path, set or verify, caps at the same character count.
describe('Password length cap', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  // A UTF-8 Cyrillic letter is two bytes: this value is 128 bytes, which the
  // old byte cap refused.
  const CYRILLIC_64 = 'Пароль1' + 'я'.repeat(57);
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
    it('accepts 64 Cyrillic characters', async () => {
      expect(CYRILLIC_64).toHaveLength(64);
      await expect(
        validate(metatype, { ...base, password: CYRILLIC_64 })
      ).resolves.toBeDefined();
    });

    it(`accepts ${MAX_PASSWORD_LENGTH} characters`, async () => {
      await expect(
        validate(metatype, { ...base, password: ASCII_128 })
      ).resolves.toBeDefined();
    });

    it(`rejects ${MAX_PASSWORD_LENGTH + 1} characters`, async () => {
      await expectRejected(
        metatype,
        { ...base, password: ASCII_128 + 'a' },
        `password must be shorter than or equal to ${MAX_PASSWORD_LENGTH} characters`
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
    ['MfaStepUpDto', MfaStepUpDto, { currentPassword: ASCII_128 }]
  ];

  describe.each(verifyPaths)(
    '%s (verifies a password)',
    (_name, metatype, payload) => {
      it(`accepts a ${MAX_PASSWORD_LENGTH}-character value`, async () => {
        await expect(validate(metatype, payload)).resolves.toBeDefined();
      });
    }
  );
});

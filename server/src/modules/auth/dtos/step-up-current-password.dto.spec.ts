import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './update-profile.dto';
import { InitiateEmailChangeDto } from './initiate-email-change.dto';

/**
 * `currentPassword` used to be required by the DTO whenever a password was
 * supplied, and unconditionally on the email-change route. An account created
 * through a provider holds no password, so the service branch that lets it
 * proceed without one was unreachable over HTTP: the pipe rejected the body
 * before the service ever saw it.
 *
 * These cases drive the same ValidationPipe the application installs, so they
 * fail against the pre-fix decorators.
 */
describe('step-up DTOs accept an absent currentPassword', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function validate(
    metatype: new () => object,
    body: unknown
  ): Promise<Record<string, unknown>> {
    return (await pipe.transform(body, {
      type: 'body',
      metatype
    })) as Record<string, unknown>;
  }

  async function expectMessages(
    metatype: new () => object,
    body: unknown
  ): Promise<string[]> {
    const error = await validate(metatype, body).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }

  describe('UpdateProfileDto', () => {
    it('passes a password change that supplies no currentPassword', async () => {
      const result = await validate(UpdateProfileDto, {
        firstName: 'John',
        lastName: 'Doe',
        password: 'Password123'
      });

      expect(result['password']).toBe('Password123');
      expect(result['currentPassword']).toBeUndefined();
    });

    it('still checks a currentPassword that is supplied', async () => {
      const messages = await expectMessages(UpdateProfileDto, {
        password: 'Password123',
        currentPassword: ''
      });

      expect(messages.join(' ')).toContain(
        'currentPassword should not be empty'
      );
    });

    it('still checks the length of a supplied currentPassword', async () => {
      const messages = await expectMessages(UpdateProfileDto, {
        password: 'Password123',
        currentPassword: 'a'.repeat(129)
      });

      expect(messages.join(' ')).toContain(
        'currentPassword must be shorter than or equal to 128 characters'
      );
    });
  });

  describe('InitiateEmailChangeDto', () => {
    it('passes an email change that supplies no currentPassword', async () => {
      const result = await validate(InitiateEmailChangeDto, {
        newEmail: 'new.user@example.com'
      });

      expect(result['newEmail']).toBe('new.user@example.com');
      expect(result['currentPassword']).toBeUndefined();
    });

    it('still checks a currentPassword that is supplied', async () => {
      const messages = await expectMessages(InitiateEmailChangeDto, {
        newEmail: 'new.user@example.com',
        currentPassword: ''
      });

      expect(messages.join(' ')).toContain(
        'currentPassword should not be empty'
      );
    });
  });
});

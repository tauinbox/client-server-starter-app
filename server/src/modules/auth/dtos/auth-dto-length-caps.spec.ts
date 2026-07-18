import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ResetPasswordDto } from './reset-password.dto';
import { VerifyEmailDto } from './verify-email.dto';
import { ConfirmEmailChangeDto } from './confirm-email-change.dto';
import { ResendVerificationDto } from './resend-verification.dto';
import { ForgotPasswordDto } from './forgot-password.dto';
import {
  AssignPermissionsDto,
  SetPermissionsDto
} from './assign-permissions.dto';
import { UpdateResourceDto } from './update-resource.dto';

// Exercises the real request validation path with the same ValidationPipe
// options as main.ts. Every field that reaches bcrypt, an indexed DB lookup,
// or a per-element validation loop must carry an upper length bound so a
// crafted oversized body is rejected with 400 before doing expensive work.
describe('Auth DTO length caps', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  const PERM_ID = '3f2b8c1e-4d5a-4f6b-8c7d-9e0f1a2b3c4d';

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

  describe('ResetPasswordDto', () => {
    it('accepts a valid payload', async () => {
      await expect(
        validate(ResetPasswordDto, {
          token: 'x'.repeat(64),
          password: 'Password123'
        })
      ).resolves.toBeDefined();
    });

    it('rejects a token longer than 512 characters', async () => {
      await expectRejected(
        ResetPasswordDto,
        { token: 'x'.repeat(513), password: 'Password123' },
        'token must be shorter than or equal to 512 characters'
      );
    });

    it('rejects a password longer than 128 characters', async () => {
      await expectRejected(
        ResetPasswordDto,
        { token: 'x', password: 'A1' + 'a'.repeat(127) },
        'password must be shorter than or equal to 128 characters'
      );
    });

    it('rejects a non-string password', async () => {
      await expectRejected(
        ResetPasswordDto,
        { token: 'x', password: 12345678 },
        'password must be a string'
      );
    });
  });

  describe('VerifyEmailDto', () => {
    it('accepts a token of exactly 512 characters', async () => {
      await expect(
        validate(VerifyEmailDto, { token: 'x'.repeat(512) })
      ).resolves.toBeDefined();
    });

    it('rejects a token longer than 512 characters', async () => {
      await expectRejected(
        VerifyEmailDto,
        { token: 'x'.repeat(513) },
        'token must be shorter than or equal to 512 characters'
      );
    });
  });

  describe('ConfirmEmailChangeDto', () => {
    it('rejects a token longer than 512 characters', async () => {
      await expectRejected(
        ConfirmEmailChangeDto,
        { token: 'x'.repeat(513) },
        'token must be shorter than or equal to 512 characters'
      );
    });
  });

  describe('ResendVerificationDto', () => {
    it('rejects an email longer than 255 characters with the length message', async () => {
      await expectRejected(
        ResendVerificationDto,
        { email: `${'a'.repeat(300)}@example.com` },
        'email must be shorter than or equal to 255 characters'
      );
    });
  });

  describe('ForgotPasswordDto', () => {
    it('rejects an email longer than 255 characters with the length message', async () => {
      await expectRejected(
        ForgotPasswordDto,
        { email: `${'a'.repeat(300)}@example.com` },
        'email must be shorter than or equal to 255 characters'
      );
    });
  });

  describe('AssignPermissionsDto', () => {
    it('accepts a small array of UUIDs', async () => {
      await expect(
        validate(AssignPermissionsDto, { permissionIds: [PERM_ID] })
      ).resolves.toBeDefined();
    });

    it('rejects an empty permissionIds array', async () => {
      await expectRejected(
        AssignPermissionsDto,
        { permissionIds: [] },
        'permissionIds should not be empty'
      );
    });

    it('rejects more than 500 permissionIds', async () => {
      await expectRejected(
        AssignPermissionsDto,
        { permissionIds: Array.from({ length: 501 }, () => PERM_ID) },
        'permissionIds must contain no more than 500 elements'
      );
    });
  });

  describe('SetPermissionsDto', () => {
    it('accepts an empty items array (replace-all semantics)', async () => {
      await expect(
        validate(SetPermissionsDto, { items: [] })
      ).resolves.toBeDefined();
    });

    it('rejects more than 500 items', async () => {
      await expectRejected(
        SetPermissionsDto,
        {
          items: Array.from({ length: 501 }, () => ({ permissionId: PERM_ID }))
        },
        'items must contain no more than 500 elements'
      );
    });
  });

  describe('UpdateResourceDto', () => {
    it('accepts a valid action-name list and null', async () => {
      await expect(
        validate(UpdateResourceDto, { allowedActionNames: ['read', 'update'] })
      ).resolves.toBeDefined();
      await expect(
        validate(UpdateResourceDto, { allowedActionNames: null })
      ).resolves.toBeDefined();
    });

    it('rejects more than 100 allowedActionNames', async () => {
      await expectRejected(
        UpdateResourceDto,
        { allowedActionNames: Array.from({ length: 101 }, () => 'read') },
        'allowedActionNames must contain no more than 100 elements'
      );
    });

    it('rejects an action name longer than 50 characters', async () => {
      await expectRejected(
        UpdateResourceDto,
        { allowedActionNames: ['x'.repeat(51)] },
        'each value in allowedActionNames must be shorter than or equal to 50 characters'
      );
    });
  });
});

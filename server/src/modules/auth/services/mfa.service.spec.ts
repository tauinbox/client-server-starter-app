import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { generateSync } from 'otplib';
import { ErrorKeys, TOKEN_PURPOSE } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MfaService } from './mfa.service';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { SecretEncryptionService } from '../../../common/crypto/secret-encryption.service';
import { hashToken } from '../../../common/utils/hash-token';
import { createMockConfigService } from '../../../common/testing/config-service.mock';

const KEY = randomBytes(32).toString('base64');

function encryptionServiceWith(key: string | undefined) {
  return new SecretEncryptionService(
    createMockConfigService({ MFA_ENCRYPTION_KEY: key ?? '' })
  );
}

function buildUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    password: '$2b$12$hash',
    isActive: true,
    isEmailVerified: true,
    locale: 'en',
    roles: [],
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    tokenRevokedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides
  });
}

describe('MfaService', () => {
  let service: MfaService;
  let encryption: SecretEncryptionService;
  // The update mock is typed, so a call argument reads as Partial<User>
  // instead of `any` at every assertion below.
  let repository: {
    update: jest.Mock<Promise<void>, [string, Partial<User>]>;
    findOne: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let auditService: { log: jest.Mock };
  let mailService: {
    sendMfaEnabledNotification: jest.Mock;
    sendMfaDisabledNotification: jest.Mock;
  };

  async function build(key: string | undefined = KEY): Promise<void> {
    encryption = encryptionServiceWith(key);
    repository = {
      update: jest
        .fn<Promise<void>, [string, Partial<User>]>()
        .mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null)
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed'),
      verify: jest.fn()
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    mailService = {
      sendMfaEnabledNotification: jest.fn().mockResolvedValue(undefined),
      sendMfaDisabledNotification: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MfaService,
        {
          provide: DataSource,
          useValue: {
            getRepository: () => repository,
            // The recovery path reads and writes under one lock, so its manager
            // resolves through the same repository mock the rest of the suite
            // asserts against.
            transaction: (
              run: (manager: {
                findOne: jest.Mock;
                update: jest.Mock;
              }) => Promise<unknown>
            ) =>
              run({
                findOne: repository.findOne,
                update: jest.fn(
                  (_entity: unknown, id: string, changes: Partial<User>) =>
                    repository.update(id, changes)
                )
              })
          }
        },
        { provide: JwtService, useValue: jwtService },
        { provide: AuditService, useValue: auditService },
        { provide: MailService, useValue: mailService },
        { provide: SecretEncryptionService, useValue: encryption }
      ]
    }).compile();

    service = module.get<MfaService>(MfaService);
  }

  beforeEach(async () => {
    await build();
  });

  /** Enrols a user for real and returns both halves of the enrolment. */
  async function enrol(): Promise<{ user: User; secret: string }> {
    const user = buildUser();
    const setup = await service.beginEnrolment(user);
    const stored = repository.update.mock.calls[0][1];
    return {
      user: buildUser({ totpSecret: stored.totpSecret }),
      secret: setup.secret
    };
  }

  describe('beginEnrolment', () => {
    it('stores the secret as ciphertext, never as the value the user reads', async () => {
      const user = buildUser();

      const setup = await service.beginEnrolment(user);
      const stored = repository.update.mock.calls[0][1];

      expect(stored.totpSecret).not.toBe(setup.secret);
      expect(stored.totpSecret).not.toContain(setup.secret);
      expect(stored.totpSecret?.startsWith('v1.')).toBe(true);
      expect(encryption.decrypt(stored.totpSecret as string)).toBe(
        setup.secret
      );
    });

    it('leaves the factor off until a code proves the authenticator', async () => {
      const stored = await service
        .beginEnrolment(buildUser())
        .then(() => repository.update.mock.calls[0][1]);

      expect(stored.totpEnabledAt).toBeNull();
      expect(stored.totpRecoveryCodes).toBeNull();
    });

    it('returns a URI and a QR image the authenticator can read', async () => {
      const setup = await service.beginEnrolment(buildUser());

      expect(setup.otpauthUri).toContain('otpauth://totp/');
      expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
      expect(setup.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('refuses when the account already carries the factor', async () => {
      await expect(
        service.beginEnrolment(buildUser({ totpEnabledAt: new Date() }))
      ).rejects.toMatchObject({
        status: 409,
        response: { errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED }
      });
    });

    it('refuses on a server with no encryption key', async () => {
      await build('');

      await expect(service.beginEnrolment(buildUser())).rejects.toMatchObject({
        status: 503,
        response: { errorKey: ErrorKeys.AUTH.MFA_UNAVAILABLE }
      });
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('completeEnrolment', () => {
    it('turns the factor on and issues recovery codes for a correct code', async () => {
      const { user, secret } = await enrol();
      repository.update.mockClear();

      const result = await service.completeEnrolment(
        user,
        generateSync({ secret })
      );

      expect(result.recoveryCodes).toHaveLength(10);
      const stored = repository.update.mock.calls[0][1];
      expect(stored.totpEnabledAt).toBeInstanceOf(Date);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.MFA_ENABLE })
      );
      expect(mailService.sendMfaEnabledNotification).toHaveBeenCalled();
    });

    it('stores recovery codes hashed, never as the codes it hands back', async () => {
      const { user, secret } = await enrol();
      repository.update.mockClear();

      const { recoveryCodes } = await service.completeEnrolment(
        user,
        generateSync({ secret })
      );
      const stored = repository.update.mock.calls[0][1];

      expect(stored.totpRecoveryCodes).not.toContain(recoveryCodes[0]);
      expect(stored.totpRecoveryCodes).toContain(
        hashToken(recoveryCodes[0].replace('-', ''))
      );
    });

    it('does not turn the factor on for a wrong code', async () => {
      const { user } = await enrol();
      repository.update.mockClear();

      await expect(
        service.completeEnrolment(user, '000000')
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE }
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MFA_CHALLENGE_FAILURE,
          details: { stage: 'enrolment' }
        })
      );
    });

    it('refuses when no enrolment was started', async () => {
      await expect(
        service.completeEnrolment(buildUser(), '000000')
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: ErrorKeys.AUTH.MFA_SETUP_REQUIRED }
      });
    });
  });

  describe('disable', () => {
    it('clears every trace of the enrolment and warns the account owner', async () => {
      const user = buildUser({
        totpSecret: 'v1.a.b.c',
        totpEnabledAt: new Date(),
        totpRecoveryCodes: ['hash']
      });

      await service.disable(user);

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        totpSecret: null,
        totpEnabledAt: null,
        totpRecoveryCodes: null
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.MFA_DISABLE })
      );
      expect(mailService.sendMfaDisabledNotification).toHaveBeenCalled();
    });

    it('refuses when the factor is not on', async () => {
      await expect(service.disable(buildUser())).rejects.toMatchObject({
        status: 400,
        response: { errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED }
      });
    });
  });

  describe('issuePendingToken', () => {
    it('signs the mfa-pending purpose, not an access token', () => {
      service.issuePendingToken(buildUser());

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          purpose: TOKEN_PURPOSE.MFA_PENDING
        }),
        expect.objectContaining({ expiresIn: 300 })
      );
    });
  });

  describe('verifyChallenge', () => {
    it('returns the account for a correct code', async () => {
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: Math.floor(Date.now() / 1000)
      });
      repository.findOne.mockResolvedValue(enabled);

      await expect(
        service.verifyChallenge('token', generateSync({ secret }))
      ).resolves.toBe(enabled);
    });

    it('refuses a wrong code and records the failure', async () => {
      const { user } = await enrol();
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: Math.floor(Date.now() / 1000)
      });
      repository.findOne.mockResolvedValue(
        buildUser({ totpSecret: user.totpSecret, totpEnabledAt: new Date() })
      );

      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE }
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MFA_CHALLENGE_FAILURE,
          details: { stage: 'challenge' }
        })
      );
    });

    it('refuses a token that carries any other purpose', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.ACCESS,
        iat: Math.floor(Date.now() / 1000)
      });

      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN }
      });
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('refuses a token minted before the account signed out everywhere', async () => {
      const issuedAt = Math.floor(Date.now() / 1000) - 60;
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: issuedAt
      });
      repository.findOne.mockResolvedValue(
        buildUser({
          totpSecret: 'v1.a.b.c',
          totpEnabledAt: new Date(),
          tokenRevokedAt: new Date()
        })
      );

      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN }
      });
    });

    it('accepts a token minted inside the second the sign-out landed in', async () => {
      // `iat` is whole seconds and the timestamp carries milliseconds, so an
      // unfloored bound refused a sign-in that followed a sign-out closely -
      // which is the ordinary "sign out, sign back in" path.
      const { user, secret } = await enrol();
      const issuedAt = Math.floor(Date.now() / 1000);
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: issuedAt
      });
      repository.findOne.mockResolvedValue(
        buildUser({
          totpSecret: user.totpSecret,
          totpEnabledAt: new Date(),
          tokenRevokedAt: new Date(issuedAt * 1000 + 700)
        })
      );

      await expect(
        service.verifyChallenge('token', generateSync({ secret }))
      ).resolves.toBeDefined();
    });

    it('refuses a token for a deactivated account', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: Math.floor(Date.now() / 1000)
      });
      repository.findOne.mockResolvedValue(
        buildUser({
          isActive: false,
          totpSecret: 'v1.a.b.c',
          totpEnabledAt: new Date()
        })
      );

      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('consumeRecoveryCode', () => {
    const code = 'ABCDEFGH-IJKLMNOP';

    function enabledWithCode(): User {
      return buildUser({
        totpSecret: 'v1.a.b.c',
        totpEnabledAt: new Date(),
        totpRecoveryCodes: [hashToken('ABCDEFGHIJKLMNOP'), 'other-hash']
      });
    }

    beforeEach(() => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: Math.floor(Date.now() / 1000)
      });
    });

    it('accepts a code once and removes it from the stored set', async () => {
      repository.findOne.mockResolvedValue(enabledWithCode());

      await service.consumeRecoveryCode('token', code);

      expect(repository.update).toHaveBeenCalledWith('user-1', {
        totpRecoveryCodes: ['other-hash']
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MFA_RECOVERY_CODE_USED,
          details: { remaining: 1 }
        })
      );
    });

    it('refuses the same code a second time', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({
          totpSecret: 'v1.a.b.c',
          totpEnabledAt: new Date(),
          totpRecoveryCodes: ['other-hash']
        })
      );

      await expect(
        service.consumeRecoveryCode('token', code)
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_RECOVERY_CODE }
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('accepts the code however the user retypes it', async () => {
      repository.findOne.mockResolvedValue(enabledWithCode());

      await expect(
        service.consumeRecoveryCode('token', 'abcdefgh ijklmnop')
      ).resolves.toBeDefined();
    });
  });

  describe('isValidStepUpCode', () => {
    it('accepts a correct code from an enrolled account', async () => {
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });

      expect(service.isValidStepUpCode(enabled, generateSync({ secret }))).toBe(
        true
      );
    });

    it('rejects a code on an account that carries no factor', async () => {
      const { secret } = await enrol();

      expect(
        service.isValidStepUpCode(buildUser(), generateSync({ secret }))
      ).toBe(false);
    });

    it('rejects a missing code', () => {
      expect(
        service.isValidStepUpCode(
          buildUser({ totpSecret: 'v1.a.b.c', totpEnabledAt: new Date() }),
          undefined
        )
      ).toBe(false);
    });

    it('rejects rather than throws when the stored secret will not decrypt', () => {
      expect(
        service.isValidStepUpCode(
          buildUser({
            totpSecret: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
            totpEnabledAt: new Date()
          }),
          '123456'
        )
      ).toBe(false);
    });
  });
});

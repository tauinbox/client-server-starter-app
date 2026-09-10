import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { generateSync } from 'otplib';
import {
  ErrorKeys,
  MAX_FAILED_ATTEMPTS,
  TOKEN_PURPOSE,
  TOTP_PERIOD_SECONDS
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MfaService } from './mfa.service';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { SecretEncryptionService } from '../../../common/crypto/secret-encryption.service';
import { hashToken } from '../../../common/utils/hash-token';
import { createMockConfigService } from '../../../common/testing/config-service.mock';
import { createMockCache } from '../../../common/testing/cache.mock';

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
    totpLastUsedStep: null,
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
    sendMfaRecoveryCodesReplacedNotification: jest.Mock;
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
      sendMfaDisabledNotification: jest.fn().mockResolvedValue(undefined),
      sendMfaRecoveryCodesReplacedNotification: jest
        .fn()
        .mockResolvedValue(undefined)
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
        { provide: SecretEncryptionService, useValue: encryption },
        { provide: CACHE_MANAGER, useValue: createMockCache() }
      ]
    }).compile();

    service = module.get<MfaService>(MfaService);
  }

  beforeEach(async () => {
    await build();
  });

  /**
   * Enrols a user for real and returns both halves of the enrolment. The row
   * is also what `findOne` resolves, because every code path now reads the
   * stored secret and the replay floor under a lock.
   */
  async function enrol(): Promise<{ user: User; secret: string }> {
    const setup = await service.beginEnrolment(buildUser());
    const stored = repository.update.mock.calls[0][1];
    const user = buildUser({ totpSecret: stored.totpSecret });
    repository.findOne.mockResolvedValue(user);
    return { user, secret: setup.secret };
  }

  /** The changes of the last `update` call, which is the one under test. */
  function lastUpdate(): Partial<User> {
    const { calls } = repository.update.mock;
    return calls[calls.length - 1][1];
  }

  /**
   * Applies what the service stored back onto the row, the way the database
   * would, so a second call in one test reads the floor the first one wrote.
   */
  function persistLedger(row: User): void {
    row.totpLastUsedStep =
      lastUpdate().totpLastUsedStep ?? row.totpLastUsedStep;
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
      expect(stored.totpLastUsedStep).toBeNull();
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
      const stored = lastUpdate();
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
      const stored = lastUpdate();

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
        totpRecoveryCodes: null,
        totpLastUsedStep: null
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

  describe('regenerateRecoveryCodes', () => {
    it('replaces the stored set with a fresh one it returns once', async () => {
      const user = buildUser({
        totpSecret: 'v1.a.b.c',
        totpEnabledAt: new Date(),
        totpRecoveryCodes: ['spent-hash']
      });

      const { recoveryCodes } = await service.regenerateRecoveryCodes(user);
      const stored = lastUpdate();

      expect(recoveryCodes).toHaveLength(10);
      expect(stored.totpRecoveryCodes).not.toContain('spent-hash');
      expect(stored.totpRecoveryCodes).not.toContain(recoveryCodes[0]);
      expect(stored.totpRecoveryCodes).toContain(
        hashToken(recoveryCodes[0].replace('-', ''))
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MFA_RECOVERY_CODES_REGENERATED
        })
      );
      expect(
        mailService.sendMfaRecoveryCodesReplacedNotification
      ).toHaveBeenCalled();
    });

    it('leaves the secret and the enrolment alone', async () => {
      const enabledAt = new Date();
      const user = buildUser({
        totpSecret: 'v1.a.b.c',
        totpEnabledAt: enabledAt,
        totpRecoveryCodes: ['spent-hash']
      });

      await service.regenerateRecoveryCodes(user);
      const stored = lastUpdate();

      expect(Object.keys(stored)).toEqual(['totpRecoveryCodes']);
    });

    it('refuses when the factor is not on', async () => {
      await expect(
        service.regenerateRecoveryCodes(buildUser())
      ).rejects.toMatchObject({
        status: 400,
        response: { errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED }
      });
      expect(repository.update).not.toHaveBeenCalled();
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
          details: { stage: 'challenge', attempt: 1 }
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

  /**
   * The route throttles are keyed by client address, so they bound one caller
   * and not one account. These cover the brake that the address cannot move.
   */
  describe('per-account brake on the authenticator challenge', () => {
    /** An enrolled account whose pending token resolves, ready to be guessed at. */
    async function guessable(): Promise<{ user: User; secret: string }> {
      const enrolment = await enrol();
      const enabled = buildUser({
        totpSecret: enrolment.user.totpSecret,
        totpEnabledAt: new Date()
      });
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: TOKEN_PURPOSE.MFA_PENDING,
        iat: Math.floor(Date.now() / 1000)
      });
      repository.findOne.mockResolvedValue(enabled);
      return { user: enabled, secret: enrolment.secret };
    }

    async function guessWrong(times: number): Promise<void> {
      for (let i = 0; i < times; i += 1) {
        await expect(
          service.verifyChallenge('token', '000000')
        ).rejects.toBeDefined();
      }
    }

    it('bars the account after the same number of tries the password gets', async () => {
      await guessable();

      await guessWrong(MAX_FAILED_ATTEMPTS - 1);
      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({
        status: 423,
        response: { errorKey: ErrorKeys.AUTH.MFA_CHALLENGE_LOCKED }
      });
    });

    it('refuses a correct code while the account is barred', async () => {
      const { secret } = await guessable();

      await guessWrong(MAX_FAILED_ATTEMPTS);

      await expect(
        service.verifyChallenge('token', generateSync({ secret }))
      ).rejects.toMatchObject({
        status: 423,
        response: { errorKey: ErrorKeys.AUTH.MFA_CHALLENGE_LOCKED }
      });
    });

    it('counts a new address into the same window', async () => {
      await guessable();

      await guessWrong(MAX_FAILED_ATTEMPTS - 1);

      // Nothing in the counter is derived from the caller, so a second source
      // address inherits the window rather than opening one of its own.
      await expect(
        service.verifyChallenge('token', '000000', { ip: '203.0.113.9' })
      ).rejects.toMatchObject({ status: 423 });
    });

    it('closes the window on a correct code', async () => {
      const { secret } = await guessable();

      await guessWrong(MAX_FAILED_ATTEMPTS - 1);
      await expect(
        service.verifyChallenge('token', generateSync({ secret }))
      ).resolves.toBeDefined();

      // The window is closed, so the next wrong code is a first strike again
      // and answers 401 rather than 423.
      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({ status: 401 });
    });

    it('reports how long the account stays barred', async () => {
      await guessable();
      await guessWrong(MAX_FAILED_ATTEMPTS - 1);

      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({
        response: { retryAfter: expect.any(Number) as unknown }
      });
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

    // A brake that shuts every door lets a caller who holds only the password
    // deny the owner their own account, which is what the recorded lockout
    // decision forbids. This is the escape hatch that keeps it open.
    it('stays open while the authenticator challenge is barred', async () => {
      const enabled = enabledWithCode();
      enabled.totpSecret = null;
      repository.findOne.mockResolvedValue(enabled);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
        await expect(
          service.verifyChallenge('token', '000000')
        ).rejects.toBeDefined();
      }
      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({ status: 423 });

      await expect(
        service.consumeRecoveryCode('token', code)
      ).resolves.toBeDefined();
    });

    it('closes the challenge window once a recovery code lands', async () => {
      const enabled = enabledWithCode();
      enabled.totpSecret = null;
      repository.findOne.mockResolvedValue(enabled);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
        await expect(
          service.verifyChallenge('token', '000000')
        ).rejects.toBeDefined();
      }
      await service.consumeRecoveryCode('token', code);

      // The owner proved possession, so the next wrong code is a first strike.
      await expect(
        service.verifyChallenge('token', '000000')
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('isValidStepUpCode', () => {
    /** An enrolled account whose row is also what the lock read resolves. */
    async function enrolled(): Promise<{ user: User; secret: string }> {
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });
      repository.findOne.mockResolvedValue(enabled);
      return { user: enabled, secret };
    }

    it('accepts a correct code from an enrolled account', async () => {
      const { user, secret } = await enrolled();

      await expect(
        service.isValidStepUpCode(user, generateSync({ secret }))
      ).resolves.toBe(true);
    });

    it('rejects a code on an account that carries no factor', async () => {
      const { secret } = await enrol();

      await expect(
        service.isValidStepUpCode(buildUser(), generateSync({ secret }))
      ).resolves.toBe(false);
    });

    it('rejects a missing code', async () => {
      await expect(
        service.isValidStepUpCode(
          buildUser({ totpSecret: 'v1.a.b.c', totpEnabledAt: new Date() }),
          undefined
        )
      ).resolves.toBe(false);
    });

    it('rejects rather than throws when the stored secret will not decrypt', async () => {
      const broken = buildUser({
        totpSecret: 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC',
        totpEnabledAt: new Date()
      });
      repository.findOne.mockResolvedValue(broken);

      await expect(service.isValidStepUpCode(broken, '123456')).resolves.toBe(
        false
      );
    });

    it('refuses the same code a second time', async () => {
      // A step-up code opens `POST /auth/mfa/disable`. An observed code that
      // stays usable for the rest of its window turns the factor off.
      const { user, secret } = await enrolled();
      const code = generateSync({ secret });

      await expect(service.isValidStepUpCode(user, code)).resolves.toBe(true);
      persistLedger(user);

      await expect(service.isValidStepUpCode(user, code)).resolves.toBe(false);
    });

    describe('per-account brake', () => {
      async function guessWrong(user: User, times: number): Promise<void> {
        for (let i = 0; i < times; i += 1) {
          await expect(service.isValidStepUpCode(user, '000000')).resolves.toBe(
            false
          );
        }
      }

      it('bars the account after the same number of tries the challenge gets', async () => {
        const { user } = await enrolled();

        await guessWrong(user, MAX_FAILED_ATTEMPTS - 1);

        // The route throttle is keyed by client address. This is the brake the
        // address cannot move, and `POST /auth/mfa/disable` is what it guards.
        await expect(
          service.isValidStepUpCode(user, '000000')
        ).rejects.toMatchObject({
          status: 423,
          response: {
            errorKey: ErrorKeys.AUTH.MFA_STEP_UP_LOCKED,
            retryAfter: expect.any(Number) as unknown
          }
        });
      });

      it('refuses a correct code while the account is barred', async () => {
        const { user, secret } = await enrolled();

        await guessWrong(user, MAX_FAILED_ATTEMPTS - 1);
        await expect(
          service.isValidStepUpCode(user, '000000')
        ).rejects.toBeDefined();

        await expect(
          service.isValidStepUpCode(user, generateSync({ secret }))
        ).rejects.toMatchObject({ status: 423 });
      });

      it('leaves the sign-in challenge open while the step-up is barred', async () => {
        const { user } = await enrolled();
        jwtService.verify.mockReturnValue({
          sub: 'user-1',
          purpose: TOKEN_PURPOSE.MFA_PENDING,
          iat: Math.floor(Date.now() / 1000)
        });

        await guessWrong(user, MAX_FAILED_ATTEMPTS - 1);
        await expect(
          service.isValidStepUpCode(user, '000000')
        ).rejects.toMatchObject({ status: 423 });

        // The two counters hold separate namespaces on purpose: a caller who
        // holds a stolen session must not be able to shut the owner out of the
        // way back in.
        await expect(
          service.verifyChallenge('token', '000000')
        ).rejects.toMatchObject({
          status: 401,
          response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE }
        });
      });

      it('does not count a step-up that offers no code', async () => {
        const { user, secret } = await enrolled();

        for (let i = 0; i < MAX_FAILED_ATTEMPTS * 2; i += 1) {
          await expect(
            service.isValidStepUpCode(user, undefined)
          ).resolves.toBe(false);
        }

        // An ordinary password step-up reaches this method as well, so it must
        // not burn the budget of an account that never offered a code.
        await expect(
          service.isValidStepUpCode(user, generateSync({ secret }))
        ).resolves.toBe(true);
      });

      it('closes the window on a correct code', async () => {
        const { user, secret } = await enrolled();

        await guessWrong(user, MAX_FAILED_ATTEMPTS - 1);
        await expect(
          service.isValidStepUpCode(user, generateSync({ secret }))
        ).resolves.toBe(true);
        persistLedger(user);

        // The window is closed, so the next wrong code is a first strike again
        // and refuses the factor rather than barring the account.
        await expect(service.isValidStepUpCode(user, '000000')).resolves.toBe(
          false
        );
      });

      it('records every refused code in the audit log', async () => {
        const { user } = await enrolled();

        await guessWrong(user, 1);

        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.MFA_CHALLENGE_FAILURE,
            details: { stage: 'step_up', attempt: 1 }
          })
        );
      });
    });
  });

  describe('code replay', () => {
    // One test pins the clock so a step boundary crossed mid-test cannot
    // change which step a code belongs to.
    afterEach(() => {
      jest.useRealTimers();
    });

    it('refuses a code the sign-in challenge already spent', async () => {
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
      const code = generateSync({ secret });

      await expect(service.verifyChallenge('token', code)).resolves.toBe(
        enabled
      );
      persistLedger(enabled);

      // The pending token outlives the code by minutes, so the whole replay
      // fits inside one challenge.
      await expect(
        service.verifyChallenge('token', code)
      ).rejects.toMatchObject({
        status: 401,
        response: { errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE }
      });
    });

    it('refuses a code older than the last one the account spent', async () => {
      // The tolerance keeps three codes live at once. Refusing only the exact
      // code that was spent would leave the two neighbours replayable.
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });
      repository.findOne.mockResolvedValue(enabled);
      const previous = generateSync({
        secret,
        epoch: Math.floor(Date.now() / 1000) - TOTP_PERIOD_SECONDS
      });

      await expect(
        service.isValidStepUpCode(enabled, generateSync({ secret }))
      ).resolves.toBe(true);
      persistLedger(enabled);

      await expect(service.isValidStepUpCode(enabled, previous)).resolves.toBe(
        false
      );
    });

    it('records the step the code matched at, not the step the clock is on', async () => {
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });
      repository.findOne.mockResolvedValue(enabled);
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-07T12:00:15Z'));
      const nowSeconds = Math.floor(Date.now() / 1000);

      await expect(
        service.isValidStepUpCode(
          enabled,
          generateSync({ secret, epoch: nowSeconds - TOTP_PERIOD_SECONDS })
        )
      ).resolves.toBe(true);

      expect(lastUpdate().totpLastUsedStep).toBe(
        Math.floor((nowSeconds - TOTP_PERIOD_SECONDS) / TOTP_PERIOD_SECONDS)
      );
    });

    it('lets the next code in once the current one is spent', async () => {
      const { user, secret } = await enrol();
      const enabled = buildUser({
        totpSecret: user.totpSecret,
        totpEnabledAt: new Date()
      });
      repository.findOne.mockResolvedValue(enabled);
      const nowSeconds = Math.floor(Date.now() / 1000);

      await expect(
        service.isValidStepUpCode(enabled, generateSync({ secret }))
      ).resolves.toBe(true);
      persistLedger(enabled);

      await expect(
        service.isValidStepUpCode(
          enabled,
          generateSync({ secret, epoch: nowSeconds + TOTP_PERIOD_SECONDS })
        )
      ).resolves.toBe(true);
    });
  });
});

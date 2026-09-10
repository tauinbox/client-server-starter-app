import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtService } from '@nestjs/jwt';
import type { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import {
  ScureBase32Plugin,
  generateSecret,
  generateURI,
  verifySync
} from 'otplib';
import {
  ErrorKeys,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  MFA_PENDING_TOKEN_EXPIRY_SECONDS,
  MFA_RECOVERY_CODE_BYTES,
  MFA_RECOVERY_CODE_COUNT,
  TOKEN_PURPOSE,
  TOTP_DIGITS,
  TOTP_EPOCH_TOLERANCE_SECONDS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS
} from '@app/shared/constants';
import type {
  MfaRecoveryCodesResponse,
  MfaSetupResponse
} from '@app/shared/types';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { User } from '../../users/entities/user.entity';
import { AuditContext, AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import {
  SecretEncryptionService,
  digestsMatch
} from '../../../common/crypto/secret-encryption.service';
import { hashToken } from '../../../common/utils/hash-token';
import { FailedAttemptCounter } from '../../../common/utils/failed-attempt-counter';
import { withTransaction } from '../../../common/utils/with-transaction.util';

const base32 = new ScureBase32Plugin();

/** Both halves of a recovery code, as the user reads it: ABCDEFGH-IJKLMNOP. */
const RECOVERY_CODE_GROUP = 8;

/** Namespace of the per-account counter of refused authenticator codes. */
const CHALLENGE_FAILURE_KEY_PREFIX = 'mfa:challenge-failures:';

/**
 * Namespace of the per-account counter of refused step-up codes. It is separate
 * from the challenge namespace on purpose: a caller who holds a stolen access
 * token must not be able to bar the owner out of the sign-in code step by
 * firing wrong codes at a step-up route.
 */
const STEP_UP_FAILURE_KEY_PREFIX = 'mfa:step-up-failures:';

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  /**
   * Bars the account, not the caller. The route throttles are keyed by client
   * address, so an attacker who already holds the password buys a fresh budget
   * of guesses with every address they add. The second factor needs one brake
   * that the source address cannot move.
   */
  readonly #challengeFailures: FailedAttemptCounter;

  /**
   * The same brake for the step-up code. The routes that spend one are
   * `POST /auth/mfa/disable` and `POST /auth/mfa/recovery-codes`, so a caller
   * who already holds a session must not get a fresh budget of guesses with
   * every address they add either.
   */
  readonly #stepUpFailures: FailedAttemptCounter;

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly encryption: SecretEncryptionService,
    @Inject(CACHE_MANAGER) cache: Cache
  ) {
    this.#challengeFailures = new FailedAttemptCounter(
      cache,
      CHALLENGE_FAILURE_KEY_PREFIX,
      this.logger
    );
    this.#stepUpFailures = new FailedAttemptCounter(
      cache,
      STEP_UP_FAILURE_KEY_PREFIX,
      this.logger
    );
  }

  /**
   * Starts an enrolment. The secret is stored encrypted straight away but the
   * factor stays off until a code proves the authenticator was set up
   * correctly, so an abandoned enrolment cannot lock anybody out.
   */
  async beginEnrolment(user: User): Promise<MfaSetupResponse> {
    this.assertAvailable();
    this.assertNotEnabled(user);

    const secret = generateSecret();
    const otpauthUri = generateURI({
      issuer: TOTP_ISSUER,
      label: user.email,
      secret,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS
    });

    await this.dataSource.getRepository(User).update(user.id, {
      totpSecret: this.encryption.encrypt(secret),
      totpEnabledAt: null,
      totpRecoveryCodes: null,
      // The floor belongs to the secret it was recorded against. A fresh
      // enrolment must not inherit it, or the first code of a new
      // authenticator is refused for as long as the old floor is ahead.
      totpLastUsedStep: null
    });

    return {
      secret,
      otpauthUri,
      qrDataUrl: await QRCode.toDataURL(otpauthUri)
    };
  }

  /**
   * Turns the factor on, but only against a code the pending secret produces.
   * Enrolling without that proof is how a user ends up with a factor no device
   * of theirs can satisfy.
   */
  async completeEnrolment(
    user: User,
    code: string,
    context?: AuditContext
  ): Promise<MfaRecoveryCodesResponse> {
    this.assertAvailable();
    this.assertNotEnabled(user);

    if (user.totpSecret === null) {
      throw new HttpException(
        {
          message: 'Start the two-factor setup before you confirm a code',
          errorKey: ErrorKeys.AUTH.MFA_SETUP_REQUIRED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!(await this.consumeTotp(user, code))) {
      await this.recordChallengeFailure(user, 'enrolment', context);
      throw this.invalidCodeException();
    }

    const recoveryCodes = this.generateRecoveryCodes();

    await this.dataSource.getRepository(User).update(user.id, {
      totpEnabledAt: new Date(),
      totpRecoveryCodes: recoveryCodes.map((code) => hashToken(normalize(code)))
    });

    await this.auditService.log({
      action: AuditAction.MFA_ENABLE,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      context
    });

    this.mailService
      .sendMfaEnabledNotification(user.email, user.locale, context?.ip)
      .catch((err) =>
        this.logger.error('Failed to send MFA enabled notification', err)
      );

    return { recoveryCodes };
  }

  /**
   * Replaces the recovery set with a fresh one. The caller has already proved
   * itself through AuthService.assertStepUp. Enrolment is the only other
   * writer of this column, and it refuses an account that carries the factor,
   * so without this an account that spent its ten codes never gets more.
   */
  async regenerateRecoveryCodes(
    user: User,
    context?: AuditContext
  ): Promise<MfaRecoveryCodesResponse> {
    this.assertEnabled(user);

    const recoveryCodes = this.generateRecoveryCodes();

    await this.dataSource.getRepository(User).update(user.id, {
      totpRecoveryCodes: recoveryCodes.map((code) => hashToken(normalize(code)))
    });

    await this.auditService.log({
      action: AuditAction.MFA_RECOVERY_CODES_REGENERATED,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      context
    });

    // The replacement silently retires the codes the owner saved, so the notice
    // is the only thing that tells them it happened.
    this.mailService
      .sendMfaRecoveryCodesReplacedNotification(
        user.email,
        user.locale,
        context?.ip
      )
      .catch((err) =>
        this.logger.error(
          'Failed to send MFA recovery codes replaced notification',
          err
        )
      );

    return { recoveryCodes };
  }

  /**
   * Turns the factor off. The caller has already proved itself through
   * AuthService.assertStepUp; this clears every trace of the enrolment so a
   * later setup starts from a fresh secret.
   */
  async disable(user: User, context?: AuditContext): Promise<void> {
    this.assertEnabled(user);

    await this.dataSource.getRepository(User).update(user.id, {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryCodes: null,
      totpLastUsedStep: null
    });

    await this.auditService.log({
      action: AuditAction.MFA_DISABLE,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      context
    });

    this.mailService
      .sendMfaDisabledNotification(user.email, user.locale, context?.ip)
      .catch((err) =>
        this.logger.error('Failed to send MFA disabled notification', err)
      );
  }

  /**
   * What a correct password buys on an account that carries the factor. The
   * `mfa_pending` purpose is what stops it being usable as a bearer token:
   * JwtStrategy accepts the access purpose only.
   */
  issuePendingToken(user: User): { mfaToken: string; expiresIn: number } {
    return {
      mfaToken: this.jwtService.sign(
        { sub: user.id, email: user.email, purpose: TOKEN_PURPOSE.MFA_PENDING },
        { expiresIn: MFA_PENDING_TOKEN_EXPIRY_SECONDS }
      ),
      expiresIn: MFA_PENDING_TOKEN_EXPIRY_SECONDS
    };
  }

  /** Exchanges a pending token plus a code for the user behind it. */
  async verifyChallenge(
    mfaToken: string,
    code: string,
    context?: AuditContext
  ): Promise<User> {
    const user = await this.userFromPendingToken(mfaToken);

    const open = await this.#challengeFailures.read(user.id);
    if (open.count >= MAX_FAILED_ATTEMPTS) {
      throw this.challengeLockedException(open.remainingMs);
    }

    if (!(await this.consumeTotp(user, code))) {
      const { count, remainingMs } = await this.#challengeFailures.record(
        user.id,
        LOCKOUT_DURATION_MS
      );
      await this.recordChallengeFailure(user, 'challenge', context, count);

      if (count >= MAX_FAILED_ATTEMPTS) {
        throw this.challengeLockedException(remainingMs);
      }
      throw this.invalidCodeException();
    }

    await this.#challengeFailures.clear(user.id);
    return user;
  }

  /**
   * Spends one recovery code. The hash is removed rather than flagged, so a
   * second use of the same code cannot match anything.
   */
  async consumeRecoveryCode(
    mfaToken: string,
    recoveryCode: string,
    context?: AuditContext
  ): Promise<User> {
    const user = await this.userFromPendingToken(mfaToken);
    const digest = hashToken(normalize(recoveryCode));

    // Read and write under one lock. A plain read-then-write lets two requests
    // presenting the same code both see it unspent, which is the one property
    // this whole path rests on.
    const remaining = await withTransaction(
      this.dataSource,
      async (manager) => {
        const locked = await manager.findOne(User, {
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' }
        });
        const stored = locked?.totpRecoveryCodes ?? [];
        const left = stored.filter((entry) => !digestsMatch(entry, digest));

        if (left.length === stored.length) return null;

        await manager.update(User, user.id, { totpRecoveryCodes: left });
        return left;
      }
    );

    if (remaining === null) {
      await this.recordChallengeFailure(user, 'recovery_code', context);
      throw new HttpException(
        {
          message: 'Recovery code is invalid or was already used',
          errorKey: ErrorKeys.AUTH.MFA_INVALID_RECOVERY_CODE
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    await this.auditService.log({
      action: AuditAction.MFA_RECOVERY_CODE_USED,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { remaining: remaining.length },
      context
    });

    // The owner proved possession, so the brake on the authenticator has done
    // its job and must not keep them out of it for the rest of the window.
    await this.#challengeFailures.clear(user.id);

    return user;
  }

  /**
   * The step-up branch for an account that carries the factor: a code proves
   * the holder as well as a password does, which is what an OAuth-only account
   * with an authenticator needs.
   */
  async isValidStepUpCode(
    user: User,
    code: string | undefined,
    context?: AuditContext
  ): Promise<boolean> {
    // Every step-up runs through here, including the ones that carry no code
    // at all. Counting those would let an ordinary password step-up burn the
    // budget of an account that never offered a code.
    if (user.totpEnabledAt === null || !code) {
      return false;
    }

    const open = await this.#stepUpFailures.read(user.id);
    if (open.count >= MAX_FAILED_ATTEMPTS) {
      throw this.stepUpLockedException(open.remainingMs);
    }

    if (!(await this.consumeTotp(user, code))) {
      const { count, remainingMs } = await this.#stepUpFailures.record(
        user.id,
        LOCKOUT_DURATION_MS
      );
      await this.recordChallengeFailure(user, 'step_up', context, count);

      if (count >= MAX_FAILED_ATTEMPTS) {
        throw this.stepUpLockedException(remainingMs);
      }
      // The caller may still hold a password, so a wrong code is a refusal of
      // this factor rather than of the whole step-up.
      return false;
    }

    await this.#stepUpFailures.clear(user.id);
    return true;
  }

  private async userFromPendingToken(mfaToken: string): Promise<User> {
    const invalidTokenError = new HttpException(
      {
        message: 'Two-factor sign-in is invalid or has expired',
        errorKey: ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN
      },
      HttpStatus.UNAUTHORIZED
    );

    let payload: { sub?: string; purpose?: string; iat?: number };
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw invalidTokenError;
    }

    if (
      payload.purpose !== TOKEN_PURPOSE.MFA_PENDING ||
      typeof payload.sub !== 'string' ||
      payload.sub === ''
    ) {
      throw invalidTokenError;
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: payload.sub },
      relations: ['roles']
    });

    // Anything that ended the account's sessions since the password check
    // must end this attempt too. The floor is load-bearing: `iat` has
    // one-second resolution and the timestamp has milliseconds, so an
    // unfloored bound refuses every sign-in inside the second a sign-out
    // landed in.
    const revokedAtSeconds = user?.tokenRevokedAt
      ? Math.floor(user.tokenRevokedAt.getTime() / 1000)
      : null;

    if (
      !user ||
      !user.isActive ||
      user.totpEnabledAt === null ||
      (revokedAtSeconds !== null &&
        (typeof payload.iat !== 'number' || payload.iat < revokedAtSeconds))
    ) {
      throw invalidTokenError;
    }

    return user;
  }

  /**
   * Verifies a code and spends it. A code that already opened something is
   * refused for the rest of its window, which is what RFC 6238 section 5.2
   * asks of a verifier: the tolerance keeps three codes live at any instant,
   * and without a ledger every one of them is replayable.
   *
   * Read and write are one atomic step, the way `consumeRecoveryCode` does it:
   * a plain read-then-write lets two requests carrying the same code both see
   * it unspent, which is the one property this buys.
   */
  private async consumeTotp(user: User, code: string): Promise<boolean> {
    if (user.totpSecret === null) {
      return false;
    }

    const token = normalize(code);

    return withTransaction(this.dataSource, async (manager) => {
      // The locked row carries the secret as well as the floor. Verifying
      // against it rather than against the caller's copy keeps a re-enrolment
      // that landed in between from being judged by the secret it replaced.
      const locked = await manager.findOne(User, {
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' }
      });

      if (!locked || locked.totpSecret === null) {
        return false;
      }

      let secret: string;
      try {
        secret = this.encryption.decrypt(locked.totpSecret);
      } catch (err) {
        // A secret that will not decrypt is a key problem, not a wrong code.
        // It must be loud in the log and must still refuse the sign-in.
        this.logger.error('Failed to decrypt a stored TOTP secret', err);
        return false;
      }

      const result = verifySync({
        secret,
        token,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
        // Refuses a match at or below the floor. Passing the step back is what
        // the library documents for replay protection, and it beats comparing
        // against the clock: a code accepted one step in the past would
        // otherwise be recorded as the current step.
        afterTimeStep: locked.totpLastUsedStep ?? undefined
      });

      // `verifySync` covers the HOTP strategy too, and that branch carries no
      // step. This call never selects it: the strategy defaults to TOTP.
      if (!result.valid || !('timeStep' in result)) {
        return false;
      }

      await manager.update(User, user.id, {
        totpLastUsedStep: result.timeStep
      });
      return true;
    });
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => {
      const encoded = base32
        .encode(crypto.randomBytes(MFA_RECOVERY_CODE_BYTES), {
          padding: false
        })
        .toUpperCase();
      const head = encoded.slice(0, RECOVERY_CODE_GROUP);
      const tail = encoded.slice(RECOVERY_CODE_GROUP);
      return head + '-' + tail;
    });
  }

  private assertAvailable(): void {
    if (!this.encryption.isConfigured) {
      throw new HttpException(
        {
          message: 'Two-factor authentication is not available on this server',
          errorKey: ErrorKeys.AUTH.MFA_UNAVAILABLE
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private assertEnabled(user: User): void {
    if (user.totpEnabledAt === null) {
      throw new HttpException(
        {
          message: 'Two-factor authentication is not enabled',
          errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private assertNotEnabled(user: User): void {
    if (user.totpEnabledAt !== null) {
      throw new HttpException(
        {
          message: 'Two-factor authentication is already enabled',
          errorKey: ErrorKeys.AUTH.MFA_ALREADY_ENABLED
        },
        HttpStatus.CONFLICT
      );
    }
  }

  private async recordChallengeFailure(
    user: User,
    stage: 'enrolment' | 'challenge' | 'recovery_code' | 'step_up',
    context?: AuditContext,
    attempt?: number
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.MFA_CHALLENGE_FAILURE,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: attempt === undefined ? { stage } : { stage, attempt },
      context
    });
  }

  /**
   * The authenticator is shut for the rest of the window. The recovery route
   * stays open on purpose: a brake that closes every door lets a caller who
   * holds only the password deny the owner their own account.
   */
  private challengeLockedException(remainingMs: number): HttpException {
    const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
    return new HttpException(
      {
        message:
          'Too many incorrect verification codes. Use a recovery code or try again later',
        errorKey: ErrorKeys.AUTH.MFA_CHALLENGE_LOCKED,
        lockedUntil: new Date(Date.now() + remainingMs).toISOString(),
        retryAfter
      },
      HttpStatus.LOCKED
    );
  }

  /**
   * The step-up code is shut for the rest of the window. The message names no
   * recovery code: that route answers a sign-in challenge, and it opens no
   * step-up.
   */
  private stepUpLockedException(remainingMs: number): HttpException {
    const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
    return new HttpException(
      {
        message: 'Too many incorrect verification codes. Try again later',
        errorKey: ErrorKeys.AUTH.MFA_STEP_UP_LOCKED,
        lockedUntil: new Date(Date.now() + remainingMs).toISOString(),
        retryAfter
      },
      HttpStatus.LOCKED
    );
  }

  private invalidCodeException(): HttpException {
    return new HttpException(
      {
        message: 'Verification code is incorrect',
        errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE
      },
      HttpStatus.UNAUTHORIZED
    );
  }
}

/**
 * Users read codes off a screen and type them back with spaces, dashes and
 * whatever case the app showed. Only the characters carry meaning.
 */
function normalize(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

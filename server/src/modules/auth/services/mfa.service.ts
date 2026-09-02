import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
import { withTransaction } from '../../../common/utils/with-transaction.util';

const base32 = new ScureBase32Plugin();

/** Both halves of a recovery code, as the user reads it: ABCDEFGH-IJKLMNOP. */
const RECOVERY_CODE_GROUP = 8;

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly encryption: SecretEncryptionService
  ) {}

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
      totpRecoveryCodes: null
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

    if (!this.isValidTotp(user.totpSecret, code)) {
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
   * Turns the factor off. The caller has already proved itself through
   * AuthService.assertStepUp; this clears every trace of the enrolment so a
   * later setup starts from a fresh secret.
   */
  async disable(user: User, context?: AuditContext): Promise<void> {
    if (user.totpEnabledAt === null) {
      throw new HttpException(
        {
          message: 'Two-factor authentication is not enabled',
          errorKey: ErrorKeys.AUTH.MFA_NOT_ENABLED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    await this.dataSource.getRepository(User).update(user.id, {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryCodes: null
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

    if (user.totpSecret === null || !this.isValidTotp(user.totpSecret, code)) {
      await this.recordChallengeFailure(user, 'challenge', context);
      throw this.invalidCodeException();
    }

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

    return user;
  }

  /**
   * The step-up branch for an account that carries the factor: a code proves
   * the holder as well as a password does, which is what an OAuth-only account
   * with an authenticator needs.
   */
  isValidStepUpCode(user: User, code: string | undefined): boolean {
    if (user.totpEnabledAt === null || user.totpSecret === null || !code) {
      return false;
    }
    return this.isValidTotp(user.totpSecret, code);
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

  private isValidTotp(encryptedSecret: string, code: string): boolean {
    let secret: string;
    try {
      secret = this.encryption.decrypt(encryptedSecret);
    } catch (err) {
      // A secret that will not decrypt is a key problem, not a wrong code. It
      // must be loud in the log and must still refuse the sign-in.
      this.logger.error('Failed to decrypt a stored TOTP secret', err);
      return false;
    }

    return verifySync({
      secret,
      token: normalize(code),
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS
    }).valid;
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
    stage: 'enrolment' | 'challenge' | 'recovery_code',
    context?: AuditContext
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.MFA_CHALLENGE_FAILURE,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { stage },
      context
    });
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

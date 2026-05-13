import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { RegisterDto } from '../dtos/register.dto';
import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { LocalAuthRequest } from '../types/auth.request';
import { RefreshTokenService } from './refresh-token.service';
import { RoleService } from './role.service';
import { TokenGeneratorService } from './token-generator.service';
import { MailService } from '../../mail/mail.service';
import { AuditService, AuditContext } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { hashToken } from '../../../common/utils/hash-token';
import { issueEmailVerificationToken } from '../../../common/utils/issue-verification-token.util';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { SYSTEM_ROLES, ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  MAX_CONCURRENT_SESSIONS,
  BCRYPT_SALT_ROUNDS,
  EMAIL_CHANGE_TOKEN_EXPIRY_MS
} from '@app/shared/constants/auth.constants';
import { InitiateEmailChangeDto } from '../dtos/initiate-email-change.dto';

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

const ENUMERATION_SAFE_INITIATE_RESPONSE = {
  message:
    'If the new email is available, a confirmation link has been sent to it.'
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private dataSource: DataSource,
    private usersService: UsersService,
    private configService: ConfigService,
    private refreshTokenService: RefreshTokenService,
    private roleService: RoleService,
    private tokenGenerator: TokenGeneratorService,
    private mailService: MailService,
    private auditService: AuditService,
    private metricsService: MetricsService
  ) {}

  // Pre-computed dummy hash for constant-time rejection (prevents timing attacks)
  private static readonly DUMMY_HASH =
    '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);

    // Check account lockout
    if (user && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfter = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 1000
      );
      this.auditService.logFireAndForget({
        action: AuditAction.USER_LOGIN_FAILURE,
        actorEmail: email,
        targetId: user.id,
        targetType: 'User',
        details: { reason: 'account_locked' }
      });
      throw new HttpException(
        {
          message:
            'Account is temporarily locked due to too many failed login attempts',
          errorKey: ErrorKeys.AUTH.ACCOUNT_LOCKED,
          lockedUntil: user.lockedUntil.toISOString(),
          retryAfter
        },
        HttpStatus.LOCKED
      );
    }

    const hashToCompare =
      user?.isActive && user.password ? user.password : AuthService.DUMMY_HASH;

    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.isActive || !user.password || !isMatch) {
      let attemptsAfterIncrement: number | null = null;
      // Handle failed login attempt atomically to prevent race conditions
      if (user && user.isActive && user.password) {
        const { failedLoginAttempts, lockedUntil } =
          await this.usersService.incrementFailedAttemptsAndLockIfNeeded(
            user.id,
            MAX_FAILED_ATTEMPTS,
            LOCKOUT_DURATION_MS
          );
        attemptsAfterIncrement = failedLoginAttempts;

        if (failedLoginAttempts >= MAX_FAILED_ATTEMPTS && lockedUntil) {
          const retryAfter = Math.ceil(
            (lockedUntil.getTime() - Date.now()) / 1000
          );
          this.auditService.logFireAndForget({
            action: AuditAction.USER_LOGIN_FAILURE,
            actorEmail: email,
            targetId: user.id,
            targetType: 'User',
            details: {
              reason: 'account_locked_after_max_attempts',
              failedLoginAttempts
            }
          });
          throw new HttpException(
            {
              message:
                'Account is temporarily locked due to too many failed login attempts',
              errorKey: ErrorKeys.AUTH.ACCOUNT_LOCKED,
              lockedUntil: lockedUntil.toISOString(),
              retryAfter
            },
            HttpStatus.LOCKED
          );
        }
      }
      this.auditService.logFireAndForget({
        action: AuditAction.USER_LOGIN_FAILURE,
        actorEmail: email,
        details: {
          reason: 'invalid_credentials',
          ...(attemptsAfterIncrement !== null
            ? { failedLoginAttempts: attemptsAfterIncrement }
            : {})
        }
      });
      this.metricsService.recordAuthEvent('login_failure');
      throw new HttpException(
        {
          message: 'Invalid credentials',
          errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    // Check email verification
    if (!user.isEmailVerified) {
      throw new HttpException(
        {
          message: 'Please verify your email address before logging in',
          errorKey: ErrorKeys.AUTH.EMAIL_NOT_VERIFIED,
          errorCode: 'EMAIL_NOT_VERIFIED'
        },
        HttpStatus.FORBIDDEN
      );
    }

    // Success — reset failed attempts
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.usersService.resetLoginAttempts(user.id);
    }

    // Return the User entity itself so ClassSerializerInterceptor can apply
    // @Exclude() / @Expose({ groups: [...] }) decorators downstream. Manually
    // building a plain object would bypass those decorators and leak fields
    // such as failedLoginAttempts / lockedUntil into the login response.
    return user;
  }

  async login(user: LocalAuthRequest['user']) {
    const roleNames = user.roles.map((r) => r.name);
    const tokens = this.tokenGenerator.generateTokens(
      user.id,
      user.email,
      roleNames
    );

    const expiresIn = parseInt(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION'),
      10
    );
    await this.refreshTokenService.createRefreshToken(
      user.id,
      tokens.refresh_token,
      expiresIn
    );
    await this.refreshTokenService.pruneOldestTokens(
      user.id,
      MAX_CONCURRENT_SESSIONS
    );

    return {
      tokens,
      user
    };
  }

  async register(
    registerDto: RegisterDto,
    auditContext?: AuditContext
  ): Promise<{ message: string }> {
    // Compute hash outside the transaction (CPU-intensive, no DB involvement)
    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      BCRYPT_SALT_ROUNDS
    );
    const { rawToken, hashedToken, expiresAt } = issueEmailVerificationToken();

    // Create user and set verification token atomically so a partial failure
    // never leaves a user without a token (which would prevent email verification).
    const user = await withTransaction(this.dataSource, async (manager) => {
      // Also reject if another user holds this address as a pending email
      // change — otherwise two accounts could claim the same address in flight.
      const existing = await manager.findOne(User, {
        where: [
          { email: registerDto.email },
          { pendingEmail: registerDto.email }
        ]
      });
      if (existing) {
        throw new HttpException(
          {
            message: 'User with this email already exists',
            errorKey: ErrorKeys.USERS.EMAIL_EXISTS
          },
          HttpStatus.CONFLICT
        );
      }

      const newUser = await manager.save(User, {
        ...registerDto,
        password: hashedPassword,
        emailVerificationToken: hashedToken,
        emailVerificationExpiresAt: expiresAt
      });

      // Assign default 'user' role
      const userRole = await this.roleService.findRoleByName(SYSTEM_ROLES.USER);
      await manager
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(newUser.id)
        .add(userRole.id);

      return newUser;
    });

    await this.auditService.log({
      action: AuditAction.USER_REGISTER,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      context: auditContext
    });

    this.metricsService.recordAuthEvent('register');

    // Send verification email (fire-and-forget — delivery failure is non-fatal)
    this.mailService
      .sendEmailVerification(user.email, rawToken)
      .catch((err) =>
        this.logger.error('Failed to send verification email', err)
      );

    return {
      message:
        'Registration successful. Please check your email to verify your account.'
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const hashedToken = hashToken(token);
    const user =
      await this.usersService.findByEmailVerificationToken(hashedToken);

    if (!user) {
      throw new HttpException(
        {
          message: 'Invalid or expired verification token',
          errorKey: ErrorKeys.AUTH.INVALID_VERIFICATION_TOKEN
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (
      user.emailVerificationExpiresAt &&
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpException(
        {
          message: 'Verification token has expired. Please request a new one.',
          errorKey: ErrorKeys.AUTH.VERIFICATION_TOKEN_EXPIRED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    await this.usersService.markEmailVerified(user.id);

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);

    // Always return success to prevent email enumeration
    if (!user || user.isEmailVerified) {
      return {
        message:
          'If an account with that email exists and is not yet verified, a verification email has been sent.'
      };
    }

    const { rawToken, hashedToken, expiresAt } = issueEmailVerificationToken();

    await this.usersService.setEmailVerificationToken(
      user.id,
      hashedToken,
      expiresAt
    );

    this.mailService
      .sendEmailVerification(user.email, rawToken)
      .catch((err) =>
        this.logger.error('Failed to resend verification email', err)
      );

    return {
      message:
        'If an account with that email exists and is not yet verified, a verification email has been sent.'
    };
  }

  async forgotPassword(
    email: string,
    auditContext?: AuditContext
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);

    // Always return success to prevent email enumeration
    if (!user || !user.isActive) {
      return {
        message:
          'If an account with that email exists, a password reset link has been sent.'
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    await this.usersService.setPasswordResetToken(
      user.id,
      hashedToken,
      expiresAt
    );

    this.auditService.logFireAndForget({
      action: AuditAction.PASSWORD_RESET_REQUEST,
      actorEmail: email,
      targetId: user.id,
      targetType: 'User',
      context: auditContext
    });

    this.mailService
      .sendPasswordReset(user.email, rawToken)
      .catch((err) =>
        this.logger.error('Failed to send password reset email', err)
      );

    return {
      message:
        'If an account with that email exists, a password reset link has been sent.'
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    auditContext?: AuditContext
  ): Promise<{ message: string }> {
    const hashedToken = hashToken(token);
    const user = await this.usersService.findByPasswordResetToken(hashedToken);

    if (!user) {
      throw new HttpException(
        {
          message: 'Invalid or expired password reset token',
          errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (
      user.passwordResetExpiresAt &&
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpException(
        {
          message:
            'Password reset token has expired. Please request a new one.',
          errorKey: ErrorKeys.AUTH.RESET_TOKEN_EXPIRED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Compute hash outside the transaction (CPU-intensive, no DB involvement)
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    // Update password, clear reset token, and invalidate all sessions atomically.
    // Without a transaction, a failure between steps could leave the account in an
    // inconsistent state (e.g. password changed but old sessions still active).
    await withTransaction(this.dataSource, async (manager) => {
      await manager.update(User, user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        // Reset also cancels any in-flight self-service email change — proof
        // of email ownership is invalidated when password ownership changes.
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpiresAt: null,
        tokenRevokedAt: new Date()
      });
      await manager.delete(RefreshToken, { userId: user.id });
    });

    await this.auditService.log({
      action: AuditAction.PASSWORD_RESET_COMPLETE,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      context: auditContext
    });

    return { message: 'Password has been reset successfully' };
  }

  async refreshTokens(refreshToken: string) {
    const tokenDoc = await this.refreshTokenService.findByToken(refreshToken);

    // OAuth 2.0 Security BCP — refresh-token reuse detection.
    // A token already revoked but not yet expired means the legitimate chain
    // has rotated past it; presenting it indicates a possible compromise.
    // Revoke ALL sessions for the user as a safety measure (RFC 6819,
    // draft-ietf-oauth-security-topics §4.13).
    if (tokenDoc && tokenDoc.revoked && !tokenDoc.isExpired()) {
      await this.revokeAllUserSessions(tokenDoc.userId);
      this.auditService.logFireAndForget({
        action: AuditAction.TOKEN_REUSE_DETECTED,
        actorId: tokenDoc.userId,
        targetId: tokenDoc.userId,
        targetType: 'User',
        details: { tokenId: tokenDoc.id }
      });
      this.metricsService.recordAuthEvent('token_reuse_detected');
      throw new HttpException(
        {
          message: 'Invalid refresh token',
          errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!tokenDoc || tokenDoc.revoked || tokenDoc.isExpired()) {
      this.auditService.logFireAndForget({
        action: AuditAction.TOKEN_REFRESH_FAILURE,
        details: { reason: 'invalid_or_expired_token' }
      });
      this.metricsService.recordAuthEvent('token_refresh_failure');
      throw new HttpException(
        {
          message: 'Invalid refresh token',
          errorKey: ErrorKeys.AUTH.INVALID_REFRESH_TOKEN
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const rawMinIat = this.configService.get<number>('JWT_MIN_IAT');
    if (rawMinIat !== undefined) {
      const minIat = Number(rawMinIat);
      if (tokenDoc.createdAt.getTime() / 1000 < minIat) {
        await this.refreshTokenService.revokeToken(tokenDoc.id);
        this.auditService.logFireAndForget({
          action: AuditAction.TOKEN_REFRESH_FAILURE,
          actorId: tokenDoc.userId,
          details: { reason: 'session_invalidated_by_rotation' }
        });
        this.metricsService.recordAuthEvent('token_refresh_failure');
        throw new HttpException(
          {
            message:
              'Session invalidated due to key rotation. Please log in again.',
            errorKey: ErrorKeys.AUTH.SESSION_INVALIDATED
          },
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const user = await this.usersService.findOne(tokenDoc.userId);
    if (!user) {
      this.auditService.logFireAndForget({
        action: AuditAction.TOKEN_REFRESH_FAILURE,
        actorId: tokenDoc.userId,
        details: { reason: 'user_not_found' }
      });
      throw new HttpException(
        { message: 'User not found', errorKey: ErrorKeys.AUTH.USER_NOT_FOUND },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!user.isActive) {
      await this.refreshTokenService.revokeToken(tokenDoc.id);
      this.auditService.logFireAndForget({
        action: AuditAction.TOKEN_REFRESH_FAILURE,
        actorId: user.id,
        actorEmail: user.email,
        details: { reason: 'user_deactivated' }
      });
      throw new HttpException(
        {
          message: 'User account is deactivated',
          errorKey: ErrorKeys.AUTH.USER_DEACTIVATED
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const roleNames = user.roles.map((r) => r.name);
    const tokens = this.tokenGenerator.generateTokens(
      user.id,
      user.email,
      roleNames
    );

    const expiresIn = parseInt(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION'),
      10
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Revoke old token and create new one atomically to prevent
    // concurrent requests from producing multiple valid sessions
    await withTransaction(this.dataSource, async (manager) => {
      await manager.update(RefreshToken, tokenDoc.id, { revoked: true });
      await manager.save(RefreshToken, {
        userId: user.id,
        token: hashToken(tokens.refresh_token),
        expiresAt
      });
    });

    const { password: _, ...userWithoutPassword } = user;

    this.metricsService.recordAuthEvent('token_refresh_success');

    return {
      tokens,
      user: userWithoutPassword
    };
  }

  /**
   * Step 1 of self-service email change. Verifies the user's current password,
   * stores the requested new address + a hashed confirmation token on the user
   * row, sends a confirmation link to the new address and an alert to the old
   * one. The user's `email` is NOT changed until step 2 (confirmEmailChange).
   *
   * Returns the same response shape regardless of whether the new address is
   * available — never leaks uniqueness state.
   */
  async initiateEmailChange(
    userId: string,
    dto: InitiateEmailChangeDto,
    auditContext?: AuditContext
  ): Promise<{ message: string }> {
    const user = await this.usersService.findOne(userId);

    if (user.password === null) {
      throw new HttpException(
        {
          message: 'Please set a password before changing your email',
          errorKey: ErrorKeys.AUTH.OAUTH_ONLY_SET_PASSWORD_FIRST
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) {
      throw new HttpException(
        {
          message: 'Current password is incorrect',
          errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (dto.newEmail === user.email) {
      throw new HttpException(
        {
          message: 'New email is the same as the current email',
          errorKey: ErrorKeys.AUTH.SAME_EMAIL
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_EXPIRY_MS);

    const conflict = await withTransaction(this.dataSource, async (manager) => {
      // Conflict if any OTHER user already holds this address as their
      // primary email OR as a pending email change in flight.
      const existing = await manager
        .createQueryBuilder(User, 'u')
        .where('(u.email = :email OR u.pendingEmail = :email)', {
          email: dto.newEmail
        })
        .andWhere('u.id != :userId', { userId })
        .getOne();

      if (existing) return true;

      await manager.update(User, userId, {
        pendingEmail: dto.newEmail,
        pendingEmailToken: hashedToken,
        pendingEmailExpiresAt: expiresAt
      });
      return false;
    });

    const domain = dto.newEmail.slice(dto.newEmail.indexOf('@') + 1);
    this.auditService.logFireAndForget({
      action: AuditAction.USER_EMAIL_CHANGE_REQUEST,
      actorId: userId,
      actorEmail: user.email,
      targetId: userId,
      targetType: 'User',
      details: { newEmailDomain: domain, conflict },
      context: auditContext
    });

    if (conflict) {
      // Enumeration-safe: same response shape as success. No email is sent —
      // we must not reveal whether the address is taken, and we must not
      // notify a third party that someone tried to claim their address.
      return ENUMERATION_SAFE_INITIATE_RESPONSE;
    }

    this.mailService
      .sendEmailChangeConfirmation(dto.newEmail, rawToken)
      .catch((err) =>
        this.logger.error('Failed to send email change confirmation', err)
      );
    this.mailService
      .sendEmailChangeNotificationOld(user.email, dto.newEmail)
      .catch((err) =>
        this.logger.error('Failed to send email change OLD-address alert', err)
      );

    return ENUMERATION_SAFE_INITIATE_RESPONSE;
  }

  /**
   * Step 2 of self-service email change. Looks up the user by the hashed
   * token, re-checks uniqueness (concurrency: another account may have
   * claimed the address since step 1), applies the change, revokes all
   * sessions, and notifies the old address.
   */
  async confirmEmailChange(
    rawToken: string,
    auditContext?: AuditContext
  ): Promise<{ message: string }> {
    const hashedToken = hashToken(rawToken);

    const result = await withTransaction(this.dataSource, async (manager) => {
      const user = await manager.findOne(User, {
        where: { pendingEmailToken: hashedToken }
      });
      if (!user || !user.pendingEmail) {
        throw new HttpException(
          {
            message: 'Invalid or expired email-change token',
            errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
          },
          HttpStatus.BAD_REQUEST
        );
      }

      if (
        user.pendingEmailExpiresAt &&
        user.pendingEmailExpiresAt.getTime() < Date.now()
      ) {
        await manager.update(User, user.id, {
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpiresAt: null
        });
        throw new HttpException(
          {
            message:
              'Email-change token has expired. Please request a new one.',
            errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
          },
          HttpStatus.BAD_REQUEST
        );
      }

      const newEmail = user.pendingEmail;
      const oldEmail = user.email;

      const conflicting = await manager
        .createQueryBuilder(User, 'u')
        .where('u.email = :email', { email: newEmail })
        .andWhere('u.id != :userId', { userId: user.id })
        .getOne();
      if (conflicting) {
        await manager.update(User, user.id, {
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpiresAt: null
        });
        throw new HttpException(
          {
            message: 'User with this email already exists',
            errorKey: ErrorKeys.USERS.EMAIL_EXISTS
          },
          HttpStatus.CONFLICT
        );
      }

      await manager.update(User, user.id, {
        email: newEmail,
        isEmailVerified: true,
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpiresAt: null,
        tokenRevokedAt: new Date()
      });
      await manager.delete(RefreshToken, { userId: user.id });

      return { userId: user.id, oldEmail, newEmail };
    });

    await this.auditService.log({
      action: AuditAction.USER_EMAIL_CHANGE_COMPLETE,
      actorId: result.userId,
      actorEmail: result.newEmail,
      targetId: result.userId,
      targetType: 'User',
      details: { oldEmail: result.oldEmail, newEmail: result.newEmail },
      context: auditContext
    });

    this.mailService
      .sendEmailChangeCompletedNotification(result.oldEmail, result.newEmail)
      .catch((err) =>
        this.logger.error(
          'Failed to send email change completed notification',
          err
        )
      );

    return {
      message:
        'Email has been updated. Please sign in again with your new email.'
    };
  }

  async verifyCurrentPassword(
    userId: string,
    currentPassword: string | undefined
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);

    // OAuth-only users (no password set yet) may set their first password
    // without supplying a current one — they never had one.
    if (user.password === null) return;

    const invalidCurrentPasswordError = new HttpException(
      {
        message: 'Current password is incorrect',
        errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
      },
      HttpStatus.BAD_REQUEST
    );

    if (!currentPassword) {
      throw invalidCurrentPasswordError;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw invalidCurrentPasswordError;
    }
  }

  async logout(userId: string): Promise<void> {
    await Promise.all([
      this.refreshTokenService.deleteByUserId(userId),
      this.dataSource
        .getRepository(User)
        .update(userId, { tokenRevokedAt: new Date() })
    ]);
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await Promise.all([
      this.refreshTokenService.deleteByUserId(userId),
      this.dataSource
        .getRepository(User)
        .update(userId, { tokenRevokedAt: new Date() })
    ]);
  }
}

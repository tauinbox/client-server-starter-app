import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { User } from '../../users/entities/user.entity';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { OAuthAccountService } from './oauth-account.service';
import { RoleService } from './role.service';
import { SessionIssuerService } from './session-issuer.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { AuditService, AuditContext } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MailService } from '../../mail/mail.service';
import { hashToken } from '../../../common/utils/hash-token';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { SYSTEM_ROLES, ErrorKeys } from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';

const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly sessionIssuer: SessionIssuerService
  ) {}

  async loginWithOAuth(profile: OAuthUserProfile) {
    // 1. Check if OAuth account already linked
    const existingOAuth =
      await this.oauthAccountService.findByProviderAndProviderId(
        profile.provider,
        profile.providerId
      );

    let user: User;

    if (existingOAuth) {
      // `lockedUntil` counts password guesses; locking the provider path too
      // would let an attacker deny the owner every way in.
      user = await this.usersService.findOne(existingOAuth.userId);
      if (!user.isActive) {
        throw new HttpException(
          {
            message: 'User account is deactivated',
            errorKey: ErrorKeys.AUTH.USER_DEACTIVATED
          },
          HttpStatus.UNAUTHORIZED
        );
      }
      // Verifying unconditionally would void the mail sent at creation for
      // providers that assert nothing (VK), opening password login on an
      // unproven address.
      if (
        !user.isEmailVerified &&
        profile.emailVerified &&
        this.assertsSameEmail(profile, user)
      ) {
        await this.usersService.markEmailVerified(user.id);
        user.isEmailVerified = true;
      }
    } else {
      // 2. Check if user exists by email.
      // Canonicalized again here rather than trusted from the strategy: this is
      // the only writer of OAuth-created users, and a provider-cased address
      // would create a duplicate the conflict check below can never see.
      const email = normalizeEmail(profile.email) ?? '';
      const existingUser = await this.usersService.findByEmail(email);

      if (existingUser) {
        // Do NOT auto-link OAuth to a pre-existing local account.
        // A provider asserting an email address is not sufficient consent
        // to take over the linked user's session. The user must explicitly
        // initiate linking from their profile page.
        throw new HttpException(
          {
            message:
              'This email is already registered. Log in with your password first, then link the provider from your profile.',
            errorKey: ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED
          },
          HttpStatus.CONFLICT
        );
      }
      // 3. Create new user + OAuth account atomically.
      // Without a transaction, a failure after user creation would leave an
      // orphaned user with no OAuth account — they would be unable to log in.
      // Email verification: trust the provider's `emailVerified` flag.
      // If the provider asserts the email is verified, mark verified;
      // otherwise issue a verification token and send the email.
      const isEmailVerified = profile.emailVerified;
      const rawVerificationToken = isEmailVerified
        ? null
        : crypto.randomBytes(32).toString('hex');
      const hashedVerificationToken = rawVerificationToken
        ? hashToken(rawVerificationToken)
        : null;
      const verificationExpiresAt = rawVerificationToken
        ? new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS)
        : null;

      const createdUserId = await withTransaction(
        this.dataSource,
        async (manager) => {
          const newUser = await manager.save(User, {
            email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            password: null,
            isEmailVerified,
            emailVerificationToken: hashedVerificationToken,
            emailVerificationExpiresAt: verificationExpiresAt
          });
          await manager.save(OAuthAccount, {
            userId: newUser.id,
            provider: profile.provider,
            providerId: profile.providerId
          });

          // Assign default 'user' role
          const userRole = await this.roleService.findRoleByName(
            SYSTEM_ROLES.USER
          );
          await manager
            .createQueryBuilder()
            .relation(User, 'roles')
            .of(newUser.id)
            .add(userRole.id);

          return newUser.id;
        }
      );

      if (rawVerificationToken) {
        this.mailService
          .sendEmailVerification(email, rawVerificationToken)
          .catch((err) =>
            this.logger.error(
              `Failed to send OAuth verification email to ${email}`,
              err
            )
          );
      }

      // Re-read with `roles` relation so the response includes the full
      // RoleResponse[] shape expected by UserResponseDto.
      user = await this.usersService.findOne(createdUserId);
    }

    return this.sessionIssuer.issueSession(user);
  }

  /** A provider vouching for a different mailbox says nothing about this one. */
  private assertsSameEmail(profile: OAuthUserProfile, user: User): boolean {
    const asserted = normalizeEmail(profile.email);
    return !!asserted && asserted === normalizeEmail(user.email);
  }

  private async safeCreateOAuthAccount(
    userId: string,
    provider: string,
    providerId: string
  ): Promise<void> {
    try {
      await this.oauthAccountService.createOAuthAccount(
        userId,
        provider,
        providerId
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        const existing =
          await this.oauthAccountService.findByProviderAndProviderId(
            provider,
            providerId
          );
        if (existing && existing.userId !== userId) {
          throw new HttpException(
            {
              message: 'This OAuth account is already linked to another user',
              errorKey: ErrorKeys.AUTH.OAUTH_ALREADY_LINKED
            },
            HttpStatus.CONFLICT
          );
        }
        // Already linked to this user — safe to ignore
        return;
      }
      throw error;
    }
  }

  /**
   * A linked provider is an authentication factor, never an email assertion:
   * the provider's address is deliberately not passed in, because linking a
   * provider whose profile carries a different mailbox is legitimate - the
   * session already proves identity.
   *
   * `linkTokenIssuedAt` is the `iat` of the link token, in seconds. It is
   * required, not optional: the caller must state when the intent was proved.
   */
  /**
   * Confirms that a completed provider round trip re-authenticated the account
   * the intent names. Two things have to hold, and neither is implied by the
   * other: the account must still be usable, and the identity the provider just
   * vouched for must already belong to it. Without the second check any second
   * account at the same provider would satisfy the gate.
   */
  async assertReauthenticated(
    userId: string,
    provider: string,
    providerId: string,
    reauthTokenIssuedAt: number
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user || !user.isActive) {
      throw new HttpException(
        {
          message: 'User account not found or deactivated',
          errorKey: ErrorKeys.AUTH.USER_NOT_FOUND_OR_DEACTIVATED
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    // Same comparison shape as the link path and the JWT strategy, so a proof
    // minted before a session revocation is refused everywhere alike.
    if (
      user.tokenRevokedAt &&
      reauthTokenIssuedAt < user.tokenRevokedAt.getTime() / 1000
    ) {
      throw new HttpException(
        {
          message: 'Token has been revoked',
          errorKey: ErrorKeys.AUTH.TOKEN_REVOKED
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const account = await this.oauthAccountService.findByProviderAndProviderId(
      provider,
      providerId
    );
    if (!account || account.userId !== userId) {
      throw new HttpException(
        {
          message: 'The provider identity does not belong to this account',
          errorKey: ErrorKeys.AUTH.REAUTH_REQUIRED
        },
        HttpStatus.UNAUTHORIZED
      );
    }
  }

  async linkOAuthToUser(
    userId: string,
    provider: string,
    providerId: string,
    linkTokenIssuedAt: number,
    auditContext?: AuditContext
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user || !user.isActive) {
      throw new HttpException(
        {
          message: 'User account not found or deactivated',
          errorKey: ErrorKeys.AUTH.USER_NOT_FOUND_OR_DEACTIVATED
        },
        HttpStatus.UNAUTHORIZED
      );
    }
    // The link intent travels in a browser cookie that can outlive the session
    // that minted it - another tab, another device, a replayed request. Same
    // comparison shape as the JWT strategy, so the two cannot drift.
    if (
      user.tokenRevokedAt &&
      linkTokenIssuedAt < user.tokenRevokedAt.getTime() / 1000
    ) {
      throw new HttpException(
        {
          message: 'Token has been revoked',
          errorKey: ErrorKeys.AUTH.TOKEN_REVOKED
        },
        HttpStatus.UNAUTHORIZED
      );
    }
    await this.safeCreateOAuthAccount(userId, provider, providerId);

    await this.auditService.log({
      action: AuditAction.OAUTH_LINK,
      actorId: userId,
      actorEmail: user.email,
      targetId: userId,
      targetType: 'User',
      details: { provider },
      context: auditContext
    });

    this.mailService
      .sendOAuthLinkedNotification(
        user.email,
        provider,
        user.locale,
        auditContext?.ip
      )
      .catch((err) =>
        this.logger.error('Failed to send provider-linked notification', err)
      );
  }
}

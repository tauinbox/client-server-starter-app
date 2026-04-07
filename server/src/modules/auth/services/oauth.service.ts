import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { User } from '../../users/entities/user.entity';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { PermissionService } from './permission.service';
import { RoleService } from './role.service';
import { TokenGeneratorService } from './token-generator.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { AuditService, AuditContext } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { SYSTEM_ROLES, ErrorKeys } from '@app/shared/constants';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants/auth.constants';

@Injectable()
export class OAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly permissionService: PermissionService,
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly tokenGenerator: TokenGeneratorService
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
      // Returning OAuth user
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
      // Auto-verify email for OAuth users
      if (!user.isEmailVerified) {
        await this.usersService.markEmailVerified(user.id);
        user.isEmailVerified = true;
      }
    } else {
      // 2. Check if user exists by email
      const existingUser = await this.usersService.findByEmail(profile.email);

      if (existingUser) {
        // Link OAuth to existing user
        if (!existingUser.isActive) {
          throw new HttpException(
            {
              message: 'User account is deactivated',
              errorKey: ErrorKeys.AUTH.USER_DEACTIVATED
            },
            HttpStatus.UNAUTHORIZED
          );
        }
        user = existingUser;
        // Auto-verify email for OAuth users
        if (!user.isEmailVerified) {
          await this.usersService.markEmailVerified(user.id);
          user.isEmailVerified = true;
        }
        await this.safeCreateOAuthAccount(
          user.id,
          profile.provider,
          profile.providerId
        );
      } else {
        // 3. Create new user + OAuth account atomically (isEmailVerified: true).
        // Without a transaction, a failure after user creation would leave an
        // orphaned user with no OAuth account — they would be unable to log in.
        user = await withTransaction(this.dataSource, async (manager) => {
          const newUser = await manager.save(User, {
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            password: null,
            isEmailVerified: true
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

          return newUser;
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    const roles = await this.permissionService.getRoleNamesForUser(user.id);
    const tokens = this.tokenGenerator.generateTokens(
      user.id,
      user.email,
      roles
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
      user: { ...userWithoutPassword, roles }
    };
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
      // PostgreSQL unique_violation error code
      const PG_UNIQUE_VIOLATION = '23505';
      const dbError = error as { code?: string };
      if (dbError.code === PG_UNIQUE_VIOLATION) {
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

  async linkOAuthToUser(
    userId: string,
    provider: string,
    providerId: string,
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
  }
}

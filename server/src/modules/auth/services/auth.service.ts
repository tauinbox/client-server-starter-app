import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/services/users.service';
import { RegisterDto } from '../dtos/register.dto';
import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { CustomJwtPayload } from '../types/jwt-payload';
import { LocalAuthRequest } from '../types/auth.request';
import { TokensResponseDto } from '../dtos/auth-response.dto';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { OAuthUserProfile } from '../types/oauth-profile';
import { MailService } from '../../mail/mail.service';
import { hashToken } from '../../../common/utils/hash-token';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS
} from '@app/shared/constants/auth.constants';

const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private dataSource: DataSource,
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private refreshTokenService: RefreshTokenService,
    private oauthAccountService: OAuthAccountService,
    private mailService: MailService
  ) {}

  // Pre-computed dummy hash for constant-time rejection (prevents timing attacks)
  private static readonly DUMMY_HASH =
    '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

  async validateUser(
    email: string,
    password: string
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findByEmail(email);

    // Check account lockout
    if (user && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfter = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 1000
      );
      throw new HttpException(
        {
          message:
            'Account is temporarily locked due to too many failed login attempts',
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
      // Handle failed login attempt
      if (user && user.isActive && user.password) {
        await this.usersService.incrementFailedAttempts(user.id);
        const updatedUser = await this.usersService.findOne(user.id);

        if (updatedUser.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
          await this.usersService.lockAccount(user.id, lockedUntil);
          const retryAfter = Math.ceil(LOCKOUT_DURATION_MS / 1000);
          throw new HttpException(
            {
              message:
                'Account is temporarily locked due to too many failed login attempts',
              lockedUntil: lockedUntil.toISOString(),
              retryAfter
            },
            HttpStatus.LOCKED
          );
        }
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check email verification
    if (!user.isEmailVerified) {
      throw new HttpException(
        {
          message: 'Please verify your email address before logging in',
          errorCode: 'EMAIL_NOT_VERIFIED'
        },
        HttpStatus.FORBIDDEN
      );
    }

    // Success — reset failed attempts
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.usersService.resetLoginAttempts(user.id);
    }

    const { password: _pw, ...result } = user;
    return result;
  }

  async login(user: LocalAuthRequest['user']) {
    const tokens = this.generateTokens(user.id, user.email, user.isAdmin);

    await this.refreshTokenService.deleteByUserId(user.id);
    await this.refreshTokenService.createRefreshToken(
      user.id,
      tokens.refresh_token,
      parseInt(this.configService.get('JWT_REFRESH_EXPIRATION') || '604800', 10)
    );

    return {
      tokens,
      user
    };
  }

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
        throw new UnauthorizedException('User account is deactivated');
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
          throw new UnauthorizedException('User account is deactivated');
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
          return newUser;
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;

    const tokens = this.generateTokens(user.id, user.email, user.isAdmin);

    await this.refreshTokenService.deleteByUserId(user.id);
    await this.refreshTokenService.createRefreshToken(
      user.id,
      tokens.refresh_token,
      parseInt(this.configService.get('JWT_REFRESH_EXPIRATION') || '604800', 10)
    );

    return {
      tokens,
      user: userWithoutPassword
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
          throw new ConflictException(
            'This OAuth account is already linked to another user'
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
    providerId: string
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account not found or deactivated');
    }
    await this.safeCreateOAuthAccount(userId, provider, providerId);
  }

  async register(registerDto: RegisterDto): Promise<{ message: string }> {
    // Compute hash outside the transaction (CPU-intensive, no DB involvement)
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);

    // Create user and set verification token atomically so a partial failure
    // never leaves a user without a token (which would prevent email verification).
    const user = await withTransaction(this.dataSource, async (manager) => {
      const existing = await manager.findOne(User, {
        where: { email: registerDto.email }
      });
      if (existing) {
        throw new ConflictException('User with this email already exists');
      }

      return manager.save(User, {
        ...registerDto,
        password: hashedPassword,
        emailVerificationToken: hashedToken,
        emailVerificationExpiresAt: expiresAt
      });
    });

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
        { message: 'Invalid or expired verification token' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (
      user.emailVerificationExpiresAt &&
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpException(
        {
          message: 'Verification token has expired. Please request a new one.'
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

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);

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

  async forgotPassword(email: string): Promise<{ message: string }> {
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
    newPassword: string
  ): Promise<{ message: string }> {
    const hashedToken = hashToken(token);
    const user = await this.usersService.findByPasswordResetToken(hashedToken);

    if (!user) {
      throw new HttpException(
        { message: 'Invalid or expired password reset token' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (
      user.passwordResetExpiresAt &&
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new HttpException(
        {
          message: 'Password reset token has expired. Please request a new one.'
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Compute hash outside the transaction (CPU-intensive, no DB involvement)
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password, clear reset token, and invalidate all sessions atomically.
    // Without a transaction, a failure between steps could leave the account in an
    // inconsistent state (e.g. password changed but old sessions still active).
    await withTransaction(this.dataSource, async (manager) => {
      await manager.update(User, user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null
      });
      await manager.delete(RefreshToken, { userId: user.id });
    });

    return { message: 'Password has been reset successfully' };
  }

  async refreshTokens(refreshToken: string) {
    const tokenDoc = await this.refreshTokenService.findByToken(refreshToken);

    if (!tokenDoc || tokenDoc.revoked || tokenDoc.isExpired()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findOne(tokenDoc.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      await this.refreshTokenService.revokeToken(tokenDoc.id);
      throw new UnauthorizedException('User account is deactivated');
    }

    await this.refreshTokenService.revokeToken(tokenDoc.id);

    const tokens = this.generateTokens(user.id, user.email, user.isAdmin);

    await this.refreshTokenService.createRefreshToken(
      user.id,
      tokens.refresh_token,
      parseInt(this.configService.get('JWT_REFRESH_EXPIRATION') || '604800', 10)
    );

    const { password: _, ...userWithoutPassword } = user;

    return {
      tokens,
      user: userWithoutPassword
    };
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokenService.deleteByUserId(userId);
  }

  private generateTokens(
    userId: string,
    email: string,
    isAdmin: boolean
  ): TokensResponseDto {
    const jwtPayload: CustomJwtPayload = {
      sub: userId,
      email,
      isAdmin
    };

    const accessTokenExpiration = parseInt(
      this.configService.get('JWT_EXPIRATION') || '3600',
      10
    );

    return {
      access_token: this.jwtService.sign(jwtPayload, {
        expiresIn: accessTokenExpiration
      }),
      refresh_token: this.generateRefreshToken(),
      expires_in: accessTokenExpiration
    };
  }

  private generateRefreshToken(): string {
    // Generate a random string to use as a refresh token
    return crypto.randomBytes(40).toString('hex');
  }
}

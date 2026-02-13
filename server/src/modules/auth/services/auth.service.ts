import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../../users/services/users.service';
import { RegisterDto } from '../dtos/register.dto';
import { User } from '../../users/entities/user.entity';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { CustomJwtPayload } from '../types/jwt-payload';
import { LocalAuthRequest } from '../types/auth.request';
import { TokensResponseDto } from '../dtos/auth-response.dto';
import { RefreshTokenService } from './refresh-token.service';
import { OAuthAccountService } from './oauth-account.service';
import { OAuthUserProfile } from '../types/oauth-profile';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private refreshTokenService: RefreshTokenService,
    private oauthAccountService: OAuthAccountService
  ) {}

  async validateUser(
    email: string,
    password: string
  ): Promise<UserResponseDto | null> {
    const user = await this.usersService.findByEmail(email);
    if (
      user &&
      user.isActive &&
      user.password &&
      (await bcrypt.compare(password, user.password))
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = user;
      return result;
    }
    return null;
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
    } else {
      // 2. Check if user exists by email
      const existingUser = await this.usersService.findByEmail(profile.email);

      if (existingUser) {
        // Link OAuth to existing user
        if (!existingUser.isActive) {
          throw new UnauthorizedException('User account is deactivated');
        }
        user = existingUser;
        await this.oauthAccountService.createOAuthAccount(
          user.id,
          profile.provider,
          profile.providerId
        );
      } else {
        // 3. Create new user + OAuth account
        user = await this.usersService.createOAuthUser({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName
        });
        await this.oauthAccountService.createOAuthAccount(
          user.id,
          profile.provider,
          profile.providerId
        );
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

  async linkOAuthAccount(userId: string, profile: OAuthUserProfile) {
    const existing = await this.oauthAccountService.findByProviderAndProviderId(
      profile.provider,
      profile.providerId
    );

    if (existing) {
      if (existing.userId !== userId) {
        throw new UnauthorizedException(
          'This OAuth account is already linked to another user'
        );
      }
      return; // Already linked to this user
    }

    await this.oauthAccountService.createOAuthAccount(
      userId,
      profile.provider,
      profile.providerId
    );
  }

  async register(registerDto: RegisterDto): Promise<User> {
    return this.usersService.create(registerDto);
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

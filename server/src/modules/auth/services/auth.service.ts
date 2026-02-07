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

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private refreshTokenService: RefreshTokenService
  ) {}

  async validateUser(
    email: string,
    password: string
  ): Promise<UserResponseDto | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.password))) {
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

    await this.refreshTokenService.revokeToken(tokenDoc.id);

    const tokens = this.generateTokens(user.id, user.email, user.isAdmin);

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

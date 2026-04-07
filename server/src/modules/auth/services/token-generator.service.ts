import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CustomJwtPayload } from '../types/jwt-payload';
import { TokensResponseDto } from '../dtos/auth-response.dto';

@Injectable()
export class TokenGeneratorService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  generateTokens(
    userId: string,
    email: string,
    roles: string[]
  ): TokensResponseDto {
    const jwtPayload: CustomJwtPayload = {
      sub: userId,
      email,
      roles
    };

    const accessTokenExpiration = parseInt(
      this.configService.getOrThrow<string>('JWT_EXPIRATION'),
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
    return crypto.randomBytes(40).toString('hex');
  }
}

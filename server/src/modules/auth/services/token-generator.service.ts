import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { TOKEN_PURPOSE } from '@app/shared/constants';
import { CustomJwtPayload } from '../types/jwt-payload';
import { TokensResponseDto } from '../dtos/auth-response.dto';
import { readJwtExpirationSeconds } from '../jwt-module-options.factory';

@Injectable()
export class TokenGeneratorService {
  private readonly accessTokenExpiration: number;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService
  ) {
    this.accessTokenExpiration = readJwtExpirationSeconds(configService);
  }

  /**
   * `sessionId` is minted by the caller because the access token has to carry
   * it before the refresh row exists. The row is then saved under the same id,
   * so the two are one session from the first request.
   */
  generateTokens(
    userId: string,
    email: string,
    sessionId: string
  ): TokensResponseDto {
    const jwtPayload: CustomJwtPayload = {
      sub: userId,
      email,
      purpose: TOKEN_PURPOSE.ACCESS,
      sid: sessionId
    };

    return {
      access_token: this.jwtService.sign(jwtPayload, {
        expiresIn: this.accessTokenExpiration
      }),
      refresh_token: this.generateRefreshToken(),
      expires_in: this.accessTokenExpiration
    };
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }
}

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { TOKEN_PURPOSE } from '@app/shared/constants';
import { CustomJwtPayload } from '../types/jwt-payload';
import { TokensResponseDto } from '../dtos/auth-response.dto';

@Injectable()
export class TokenGeneratorService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  /**
   * `sessionId` is minted by the caller because the access token has to carry
   * it before the refresh row exists. The row is then saved under the same id,
   * so the two are one session from the first request.
   */
  generateTokens(
    userId: string,
    email: string,
    roles: string[],
    sessionId: string
  ): TokensResponseDto {
    const jwtPayload: CustomJwtPayload = {
      sub: userId,
      email,
      roles,
      purpose: TOKEN_PURPOSE.ACCESS,
      sid: sessionId
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

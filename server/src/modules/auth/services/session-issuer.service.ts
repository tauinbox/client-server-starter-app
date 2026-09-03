import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { User } from '../../users/entities/user.entity';
import { TokensResponseDto } from '../dtos/auth-response.dto';
import { RefreshTokenService } from './refresh-token.service';
import { SessionLimitService } from './session-limit.service';
import { TokenGeneratorService } from './token-generator.service';

/**
 * The single place a sign-in turns into a session. Both the password and the
 * OAuth path go through here so the two can never drift: a plan allowance
 * applied to one only would trim a paid user's devices the moment they signed
 * in the other way.
 *
 * Token rotation deliberately does NOT use this: it replaces one session
 * instead of adding one, so it revokes and re-inserts inside a transaction and
 * runs no prune at all.
 */
@Injectable()
export class SessionIssuerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly sessionLimitService: SessionLimitService,
    private readonly tokenGenerator: TokenGeneratorService
  ) {}

  /**
   * Order matters: the refresh token is persisted before the prune runs, so the
   * session just issued is counted against the allowance rather than surviving
   * a full quota by not existing yet.
   *
   * Returns the User entity, not a spread: a plain object carries no
   * class-transformer metadata, so ClassSerializerInterceptor could not strip
   * `@Exclude()` fields downstream.
   *
   * The session id is minted here rather than taken from the refresh row,
   * because the access token is signed before that row exists and both have to
   * carry the same value.
   */
  async issueSession(
    user: User
  ): Promise<{ tokens: TokensResponseDto; user: User }> {
    const roleNames = user.roles.map((r) => r.name);
    const sessionId = randomUUID();
    const tokens = this.tokenGenerator.generateTokens(
      user.id,
      user.email,
      roleNames,
      sessionId
    );

    const expiresIn = parseInt(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION'),
      10
    );
    await this.refreshTokenService.createRefreshToken(
      user.id,
      tokens.refresh_token,
      expiresIn,
      sessionId
    );
    await this.refreshTokenService.pruneOldestTokens(
      user.id,
      await this.sessionLimitService.maxSessionsFor(user.id)
    );

    return {
      tokens,
      user
    };
  }
}

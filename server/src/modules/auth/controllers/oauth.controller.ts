import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Request,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { randomUUID } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { instanceToPlain } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { OAuthService } from '../services/oauth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { GoogleOAuthGuard } from '../guards/google-oauth.guard';
import { FacebookOAuthGuard } from '../guards/facebook-oauth.guard';
import { VkOAuthGuard } from '../guards/vk-oauth.guard';
import { Public } from '../decorators/public.decorator';
import { OAuthUserProfile } from '../types/oauth-profile';
import { JwtAuthRequest } from '../types/auth.request';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import {
  ErrorKeys,
  REAUTH_PROOF_MAX_AGE_SECONDS,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE
} from '@app/shared/constants';
import { CLIENT_URL } from '../providers/client-url.provider';
import { OAuthAuthenticationExceptionFilter } from '../filters/oauth-authentication-exception.filter';
import { OAUTH_ERROR_REAUTH_FAILED } from '../exceptions/oauth-authentication-failed.exception';
import {
  OAUTH_INTENT_COOKIE_PATH,
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  REAUTH_PROOF_COOKIE,
  REAUTH_PROOF_COOKIE_PATH
} from '../constants/oauth.constants';
import { readIntentForFlow } from '../utils/oauth-flow-intent';
import { isStepUpOperation } from '@app/shared/utils/step-up-operation';
import { ReauthInitDto } from '../dtos/reauth-init.dto';
import { OAuthLinkInitDto } from '../dtos/oauth-link-init.dto';
import { OAuthUnlinkDto } from '../dtos/oauth-unlink.dto';
import { CHALLENGE_THROTTLE } from '../constants/throttle.constants';
import { CountFailuresOnlyWhenBody } from '../../core/failure-counter.decorator';
import { AuthService } from '../services/auth.service';
import { SingleUseTokenLedger } from '../../../common/utils/single-use-token-ledger';
import { MfaRequiredResponseDto } from '../dtos/mfa.dto';

@ApiTags('OAuth API')
@Controller({
  path: 'auth/oauth',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
@UseFilters(OAuthAuthenticationExceptionFilter)
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  private static readonly OAUTH_LINK_MAX_AGE_SECONDS = 300;
  private static readonly OAUTH_DATA_COOKIE = 'oauth_data';
  private static readonly OAUTH_DATA_MAX_AGE_SECONDS = 60;

  private readonly oauthDataLedger: SingleUseTokenLedger;

  constructor(
    private readonly oauthService: OAuthService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    @Inject(CLIENT_URL) private readonly clientUrl: string,
    @Inject(CACHE_MANAGER) cache: Cache
  ) {
    this.oauthDataLedger = new SingleUseTokenLedger(
      cache,
      'oauth-data:spent:',
      this.logger
    );
  }

  // --- Link initiation ---

  /**
   * A linked provider is a sign-in credential that outlives every session, and
   * no recovery path deletes it: a password reset ends the sessions and leaves
   * the row. A stolen session must therefore not be able to plant one, so this
   * demands the same fresh proof of identity the other credential changes do.
   */
  @Throttle(CHALLENGE_THROTTLE)
  @CountFailuresOnlyWhenBody('currentPassword')
  @Post('link-init')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate OAuth account linking for current user' })
  @ApiBody({ type: OAuthLinkInitDto })
  async initOAuthLink(
    @Request() req: JwtAuthRequest,
    @Body() dto: OAuthLinkInitDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const reauthProof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];

    await this.authService.assertStepUpForUser(
      req.user.userId,
      dto.currentPassword,
      reauthProof,
      STEP_UP_OPERATION.OAUTH_LINK,
      extractAuditContext(req)
    );

    const linkToken = this.jwtService.sign(
      { sub: req.user.userId, purpose: TOKEN_PURPOSE.OAUTH_LINK },
      { expiresIn: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS }
    );

    res.cookie(OAUTH_LINK_COOKIE, linkToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('ENVIRONMENT') === 'production',
      path: OAUTH_INTENT_COOKIE_PATH,
      maxAge: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS * 1000
    });

    return { message: 'Link initiated' };
  }

  // --- Step-up re-authentication initiation ---

  /**
   * Starts a step-up re-authentication for an account that holds no password.
   * The provider round trip that follows proves the caller still controls the
   * identity the account is linked to, and the callback mints the proof.
   *
   * The operation travels in the intent token, so the proof the callback mints
   * is bound to the change the user asked for and authorizes nothing else.
   */
  @Post('reauth-init')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initiate a step-up re-authentication through a linked provider'
  })
  @ApiBody({ type: ReauthInitDto })
  initOAuthReauth(
    @Request() req: JwtAuthRequest,
    @Body() dto: ReauthInitDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const reauthToken = this.jwtService.sign(
      {
        sub: req.user.userId,
        purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
        operation: dto.operation
      },
      { expiresIn: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS }
    );

    res.cookie(OAUTH_REAUTH_COOKIE, reauthToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('ENVIRONMENT') === 'production',
      path: OAUTH_INTENT_COOKIE_PATH,
      maxAge: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS * 1000
    });

    return { message: 'Re-authentication initiated' };
  }

  // --- Google ---

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleLogin(): void {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Request() req: ExpressRequest & { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, req, res);
  }

  // --- Facebook ---

  @Public()
  @Get('facebook')
  @UseGuards(FacebookOAuthGuard)
  @ApiOperation({ summary: 'Initiate Facebook OAuth login' })
  facebookLogin(): void {
    // Guard redirects to Facebook
  }

  @Public()
  @Get('facebook/callback')
  @UseGuards(FacebookOAuthGuard)
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookCallback(
    @Request() req: ExpressRequest & { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, req, res);
  }

  // --- VK ---

  @Public()
  @Get('vk')
  @UseGuards(VkOAuthGuard)
  @ApiOperation({ summary: 'Initiate VK OAuth login' })
  vkLogin(): void {
    // Guard redirects to VK
  }

  @Public()
  @Get('vk/callback')
  @UseGuards(VkOAuthGuard)
  @ApiOperation({ summary: 'VK OAuth callback' })
  async vkCallback(
    @Request() req: ExpressRequest & { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, req, res);
  }

  // --- OAuth accounts management ---

  @Get('/accounts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get linked OAuth accounts for current user' })
  @ApiOkResponse({ description: 'List of linked OAuth accounts' })
  async getOAuthAccounts(@Request() req: JwtAuthRequest) {
    const accounts = await this.oauthAccountService.findByUserId(
      req.user.userId
    );
    return accounts.map((account) => ({
      provider: account.provider,
      createdAt: account.createdAt
    }));
  }

  /**
   * Removing a provider is a credential change in the same way that adding one
   * is: the row it deletes is a sign-in method, and a stolen session must not
   * be able to strip the owner of one. So the route demands the same fresh
   * proof of identity the link route demands.
   */
  @Throttle(CHALLENGE_THROTTLE)
  @CountFailuresOnlyWhenBody('currentPassword')
  @Delete('/accounts/:provider')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink an OAuth provider from current user' })
  @ApiParam({
    name: 'provider',
    enum: OAuthProvider,
    description: 'OAuth provider to unlink'
  })
  @ApiBody({ type: OAuthUnlinkDto, required: false })
  async unlinkOAuth(
    @Param('provider') provider: string,
    @Request() req: JwtAuthRequest,
    @Body() dto: OAuthUnlinkDto
  ) {
    if (!Object.values(OAuthProvider).includes(provider as OAuthProvider)) {
      throw new HttpException(
        {
          message: `Invalid OAuth provider: ${provider}`,
          errorKey: ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const userId = req.user.userId;

    const reauthProof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];

    await this.authService.assertStepUpForUser(
      userId,
      dto.currentPassword,
      reauthProof,
      STEP_UP_OPERATION.OAUTH_UNLINK,
      extractAuditContext(req)
    );

    const { email, locale } = await this.oauthAccountService.unlinkProvider(
      userId,
      provider
    );

    await this.auditService.log({
      action: AuditAction.OAUTH_UNLINK,
      actorId: userId,
      actorEmail: req.user.email,
      targetId: userId,
      targetType: 'User',
      details: { provider },
      context: extractAuditContext(req)
    });

    this.mailService
      .sendOAuthUnlinkedNotification(email, provider, locale, req.ip)
      .catch((err) =>
        this.logger.error('Failed to send provider-unlinked notification', err)
      );

    return { message: `${provider} account unlinked successfully` };
  }

  // --- Common callback handler ---

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('exchange')
  @ApiOperation({ summary: 'Exchange OAuth data cookie for auth response' })
  @ApiOkResponse({
    description:
      'Auth response from OAuth login, or a challenge when the account carries a second factor'
  })
  async exchangeOAuthData(
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[
      OAuthController.OAUTH_DATA_COOKIE
    ];

    res.clearCookie(OAuthController.OAUTH_DATA_COOKIE, {
      path: '/api/v1/auth/oauth'
    });

    if (!cookie) {
      throw new HttpException(
        {
          message: 'Missing OAuth data',
          errorKey: ErrorKeys.AUTH.MISSING_OAUTH_DATA
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // getOrThrow, outside the try: a missing value must fail loudly (500),
    // not silently downgrade the refresh cookie to a session cookie via a
    // NaN maxAge or get masked as an invalid-OAuth-data 400.
    const maxAge =
      Number(this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION')) *
      1000;

    try {
      const payload = this.jwtService.verify<{
        purpose?: string;
        jti?: string;
        data:
          | {
              tokens: {
                refresh_token: string;
                access_token: string;
                expires_in: number;
              };
              user: unknown;
            }
          | MfaRequiredResponseDto;
      }>(cookie);
      if (payload.purpose !== TOKEN_PURPOSE.OAUTH_DATA) {
        throw new Error('Unexpected token purpose');
      }
      // Clearing the cookie only spends the credential in the caller's own
      // browser. A value captured before the exchange stays valid for the rest
      // of its 60 seconds unless the server records that it was already spent.
      if (!payload.jti) {
        throw new Error('Missing token id');
      }
      if (
        !(await this.oauthDataLedger.claim(
          payload.jti,
          OAuthController.OAUTH_DATA_MAX_AGE_SECONDS * 1000
        ))
      ) {
        throw new Error('OAuth data already exchanged');
      }
      // The account carries a second factor, so the round trip bought only the
      // right to present a code. No session exists yet and no cookie is set.
      if ('mfaRequired' in payload.data) {
        return payload.data;
      }
      const { refresh_token, ...publicTokens } = payload.data.tokens;
      res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: this.configService.get('ENVIRONMENT') === 'production',
        sameSite: 'strict',
        path: '/api/v1/auth',
        maxAge
      });
      return { tokens: publicTokens, user: payload.data.user };
    } catch {
      throw new HttpException(
        {
          message: 'Invalid or expired OAuth data',
          errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async handleOAuthCallback(
    profile: OAuthUserProfile,
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const flowState = req.query?.['state'];

      // A cookie says which user this round trip is for; only the state says
      // which flow may act on it, so an intent belonging to another flow leaves
      // this callback a plain sign-in. Neither is cleared here: each stays
      // consumable by its own flow, which may still finish. Re-authentication
      // wins a tie because it links nothing.
      const reauthIntent = cookies?.[OAUTH_REAUTH_COOKIE];
      const reauthToken = reauthIntent
        ? readIntentForFlow(reauthIntent, flowState)
        : null;

      if (reauthToken) {
        return this.handleOAuthReauth(reauthToken, profile, res);
      }

      const linkIntent = cookies?.[OAUTH_LINK_COOKIE];
      const linkToken = linkIntent
        ? readIntentForFlow(linkIntent, flowState)
        : null;

      if (linkToken) {
        return this.handleOAuthLink(linkToken, profile, req, res);
      }

      if (!profile.email) {
        this.logger.warn(
          `OAuth login failed: no email provided by ${profile.provider}`
        );
        res.redirect(`${this.clientUrl}/login?oauth_error=no_email`);
        return;
      }

      const result = await this.oauthService.loginWithOAuth(profile);

      // Serialize here, not at /exchange: the cookie payload is plain JSON, so
      // an entity signed as-is would be echoed verbatim past any interceptor.
      // A challenge carries no entity, so it travels as it stands.
      const signedData = this.jwtService.sign(
        {
          data:
            'mfaRequired' in result
              ? result
              : { tokens: result.tokens, user: instanceToPlain(result.user) },
          purpose: TOKEN_PURPOSE.OAUTH_DATA,
          jti: randomUUID()
        },
        { expiresIn: OAuthController.OAUTH_DATA_MAX_AGE_SECONDS }
      );

      res.cookie(OAuthController.OAUTH_DATA_COOKIE, signedData, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.configService.get('ENVIRONMENT') === 'production',
        path: '/api/v1/auth/oauth',
        maxAge: OAuthController.OAUTH_DATA_MAX_AGE_SECONDS * 1000
      });

      res.redirect(`${this.clientUrl}/oauth/callback`);
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getResponse() as { errorKey?: string })?.errorKey ===
          ErrorKeys.AUTH.OAUTH_EMAIL_ALREADY_REGISTERED
      ) {
        res.redirect(
          `${this.clientUrl}/login?oauth_error=email_already_registered`
        );
        return;
      }
      this.logger.error('OAuth callback error', error);
      res.redirect(`${this.clientUrl}/login?oauth_error=auth_failed`);
    }
  }

  /**
   * Turns one completed provider round trip into a short-lived proof that the
   * caller re-authenticated. It mints no session and links nothing, so the
   * worst a stolen intent can produce is a proof for an account whose provider
   * identity the attacker already controls.
   *
   * The proof repeats the operation the intent declared. A proof minted to
   * change an address therefore cannot bind a password.
   */
  private async handleOAuthReauth(
    reauthToken: string,
    profile: OAuthUserProfile,
    res: Response
  ): Promise<void> {
    res.clearCookie(OAUTH_REAUTH_COOKIE, {
      path: OAUTH_INTENT_COOKIE_PATH
    });

    try {
      const payload = this.jwtService.verify<{
        sub: string;
        purpose?: string;
        operation?: string;
        iat?: number;
      }>(reauthToken);
      if (payload.purpose !== TOKEN_PURPOSE.OAUTH_REAUTH) {
        throw new Error('Unexpected token purpose');
      }
      if (!isStepUpOperation(payload.operation)) {
        throw new Error('Re-authentication token names no known operation');
      }
      // The service compares this against the last session revocation, so a
      // token without one is refused rather than trusted.
      if (typeof payload.iat !== 'number') {
        throw new Error('Re-authentication token carries no issue time');
      }

      await this.oauthService.assertReauthenticated(
        payload.sub,
        profile.provider,
        profile.providerId,
        payload.iat
      );

      const proof = this.jwtService.sign(
        {
          sub: payload.sub,
          purpose: TOKEN_PURPOSE.REAUTH_PROOF,
          operation: payload.operation
        },
        { expiresIn: REAUTH_PROOF_MAX_AGE_SECONDS }
      );

      res.cookie(REAUTH_PROOF_COOKIE, proof, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.configService.get('ENVIRONMENT') === 'production',
        path: REAUTH_PROOF_COOKIE_PATH,
        maxAge: REAUTH_PROOF_MAX_AGE_SECONDS * 1000
      });

      res.redirect(`${this.clientUrl}/profile?reauth=ok`);
    } catch (error) {
      this.logger.error('OAuth re-authentication error', error);
      res.redirect(
        `${this.clientUrl}/profile?oauth_error=${OAUTH_ERROR_REAUTH_FAILED}`
      );
    }
  }

  private async handleOAuthLink(
    linkToken: string,
    profile: OAuthUserProfile,
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    res.clearCookie(OAUTH_LINK_COOKIE, {
      path: OAUTH_INTENT_COOKIE_PATH
    });

    try {
      const payload = this.jwtService.verify<{
        sub: string;
        purpose?: string;
        iat?: number;
      }>(linkToken);
      if (payload.purpose !== TOKEN_PURPOSE.OAUTH_LINK) {
        throw new Error('Unexpected token purpose');
      }
      // The service compares this against the last session revocation, so a
      // token without one is refused rather than trusted.
      if (typeof payload.iat !== 'number') {
        throw new Error('Link token carries no issue time');
      }
      const userId = payload.sub;

      await this.oauthService.linkOAuthToUser(
        userId,
        profile.provider,
        profile.providerId,
        payload.iat,
        extractAuditContext(req)
      );

      res.redirect(
        `${this.clientUrl}/profile?oauth_linked=${profile.provider}`
      );
    } catch (error) {
      this.logger.error('OAuth link error', error);
      res.redirect(`${this.clientUrl}/profile?oauth_error=link_failed`);
    }
  }
}

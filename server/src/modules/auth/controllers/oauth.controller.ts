import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Logger,
  Param,
  Post,
  Request,
  Res,
  UseFilters,
  UseGuards
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
import { Throttle } from '@nestjs/throttler';
import { OAuthService } from '../services/oauth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { PurposeTokenService } from '../services/purpose-token.service';
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
  OAUTH_ERROR,
  REAUTH_PROOF_MAX_AGE_SECONDS,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE,
  type ErrorKey,
  type SignInRefusalReason
} from '@app/shared/constants';
import { CLIENT_URL } from '../providers/client-url.provider';
import { OAuthAuthenticationExceptionFilter } from '../filters/oauth-authentication-exception.filter';
import { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import { AccountRefusedException } from '../exceptions/account-refused.exception';
import {
  OAUTH_DATA_COOKIE,
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  REAUTH_PROOF_COOKIE
} from '../constants/oauth.constants';
import { AuthCookies, claimedFlow } from '../utils/auth-cookies';
import {
  OAuthFailureAudit,
  type OAuthIntentAccount
} from '../utils/oauth-failure-audit';
import { isStepUpOperation } from '@app/shared/utils/step-up-operation';
import { signedTokenAccount } from '@app/shared/utils/token-revocation';
import { ReauthInitDto } from '../dtos/reauth-init.dto';
import { StepUpFactorsDto } from '../dtos/step-up-factors.dto';
import { StepUpRoute } from '../decorators/step-up-route.decorator';
import { AuthService } from '../services/auth.service';
import { SignInCompletionService } from '../services/sign-in-completion.service';
import { UsersService } from '../../users/services/users.service';
import { SingleUseTokenLedger } from '../../../common/utils/single-use-token-ledger';
import { MfaRequiredResponseDto } from '../dtos/mfa.dto';
import { ApiError } from '../../../common/errors/api-error';

/** What the callback signs into the `oauth_data` cookie for a plain sign-in. */
interface OAuthSignInData {
  userId: string;
  provider: string;
}

function invalidOAuthData(): ApiError {
  return new ApiError(
    ErrorKeys.AUTH.INVALID_OAUTH_DATA,
    'Invalid or expired OAuth data'
  );
}

/** The `reason` of a row whose intent cookie did not verify. */
const INTENT_INVALID_REASON: SignInRefusalReason = 'intent_invalid';

/**
 * The `reason` of a link or step-up refusal of the service. The error key is
 * the answer to the client, and its text changes with the answer, so the
 * audit row gets a value of the refusal vocabulary instead.
 */
const OAUTH_REFUSAL_REASONS: Partial<Record<ErrorKey, SignInRefusalReason>> = {
  [ErrorKeys.AUTH.OAUTH_ALREADY_LINKED]: 'identity_linked_elsewhere',
  [ErrorKeys.AUTH.OAUTH_PROVIDER_ALREADY_LINKED]: 'provider_already_linked',
  [ErrorKeys.AUTH.REAUTH_REQUIRED]: 'identity_not_linked'
};

/** The `reason` of an audit row for a refused provider callback. */
function oauthFailureReason(error: unknown): SignInRefusalReason {
  if (error instanceof AccountRefusedException) {
    return error.refusal;
  }

  if (error instanceof OAuthAuthenticationFailedException) {
    return error.fault ? 'unexpected_error' : error.oauthError;
  }

  if (error instanceof ApiError) {
    return OAUTH_REFUSAL_REASONS[error.errorKey] ?? 'unexpected_error';
  }

  return 'unexpected_error';
}

/**
 * The level rule of the global exception filter, applied here because the
 * callback answers with a redirect and no exception reaches that filter: a
 * refusal is a warning, a fault is an error with its stack.
 */
function logCallbackFailure(
  logger: Logger,
  {
    label,
    provider,
    error
  }: { label: string; provider: string; error: unknown }
): void {
  if (isRefusal(error)) {
    logger.warn(`${label} via ${provider}: ${error.message}`);

    return;
  }

  logger.error(`${label} via ${provider}`, error);
}

function isRefusal(error: unknown): error is Error {
  return (
    (error instanceof OAuthAuthenticationFailedException && !error.fault) ||
    (error instanceof HttpException && error.getStatus() < 500)
  );
}

@ApiTags('OAuth API')
@Controller({
  path: 'auth/oauth',
  version: '1'
})
@UseFilters(OAuthAuthenticationExceptionFilter)
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  private static readonly OAUTH_LINK_MAX_AGE_SECONDS = 300;
  private static readonly OAUTH_DATA_MAX_AGE_SECONDS = 60;

  private readonly oauthDataLedger: SingleUseTokenLedger;

  constructor(
    private readonly oauthService: OAuthService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly authService: AuthService,
    private readonly cookies: AuthCookies,
    private readonly purposeTokens: PurposeTokenService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly failureAudit: OAuthFailureAudit,
    private readonly usersService: UsersService,
    private readonly signIn: SignInCompletionService,
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
   * A linked provider is a sign-in credential that outlives every session; only
   * an unlink or an account recovery deletes it. A stolen session must
   * therefore not be able to plant one, so this demands the same fresh proof of
   * identity the other credential changes do.
   */
  @StepUpRoute(StepUpFactorsDto)
  @Post('link-init')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate OAuth account linking for current user' })
  async initOAuthLink(
    @Request() req: JwtAuthRequest,
    @Body() dto: StepUpFactorsDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const reauthProof = this.cookies.readReauthProof(req);

    await this.authService.assertStepUpForUser(req.user.userId, {
      currentPassword: dto.currentPassword,
      reauthProof,
      operation: STEP_UP_OPERATION.OAUTH_LINK,
      totpCode: dto.code,
      auditContext: extractAuditContext(req)
    });

    const linkToken = this.purposeTokens.sign(
      { sub: req.user.userId, email: req.user.email },
      {
        purpose: TOKEN_PURPOSE.OAUTH_LINK,
        expiresIn: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS
      }
    );

    this.cookies.setShortLived(
      res,
      { base: OAUTH_LINK_COOKIE, value: linkToken },
      OAuthController.OAUTH_LINK_MAX_AGE_SECONDS
    );

    // Cleared only now, so a rejected attempt keeps its remaining proof
    // window. The ledger already refuses a second use of the value.
    this.cookies.clearReauthProof(res);

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
    const reauthToken = this.purposeTokens.sign(
      {
        sub: req.user.userId,
        email: req.user.email,
        operation: dto.operation
      },
      {
        purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
        expiresIn: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS
      }
    );

    this.cookies.setShortLived(
      res,
      { base: OAUTH_REAUTH_COOKIE, value: reauthToken },
      OAuthController.OAUTH_LINK_MAX_AGE_SECONDS
    );

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
  @StepUpRoute(StepUpFactorsDto)
  @Delete('/accounts/:provider')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink an OAuth provider from current user' })
  @ApiParam({
    name: 'provider',
    enum: OAuthProvider,
    description: 'OAuth provider to unlink'
  })
  async unlinkOAuth(
    @Param('provider') provider: string,
    @Request() req: JwtAuthRequest,
    @Body() dto: StepUpFactorsDto,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!Object.values(OAuthProvider).includes(provider as OAuthProvider)) {
      throw new ApiError(
        ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER,
        `Invalid OAuth provider: ${provider}`
      );
    }

    const { userId } = req.user;

    const reauthProof = this.cookies.readReauthProof(req);

    await this.authService.assertStepUpForUser(userId, {
      currentPassword: dto.currentPassword,
      reauthProof,
      operation: STEP_UP_OPERATION.OAUTH_UNLINK,
      totpCode: dto.code,
      auditContext: extractAuditContext(req)
    });

    const { email, locale } = await this.oauthAccountService.unlinkProvider(
      userId,
      provider
    );

    // Cleared only now, so a rejected attempt keeps its remaining proof
    // window. The ledger already refuses a second use of the value.
    this.cookies.clearReauthProof(res);

    this.auditService.logFireAndForget({
      action: AuditAction.OAUTH_UNLINK,
      actorId: userId,
      actorEmail: req.user.email,
      targetId: userId,
      targetType: 'User',
      details: { provider },
      context: extractAuditContext(req)
    });

    this.mailService
      .sendOAuthUnlinkedNotification(email, provider, { locale, ip: req.ip })
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
    const cookie = this.cookies.read(req, OAUTH_DATA_COOKIE);

    this.cookies.clear(res, OAUTH_DATA_COOKIE);

    if (!cookie) {
      throw new ApiError(
        ErrorKeys.AUTH.MISSING_OAUTH_DATA,
        'Missing OAuth data'
      );
    }

    let data: OAuthSignInData | MfaRequiredResponseDto;
    let issuedAtMs: number;

    try {
      const payload = this.purposeTokens.verify<{
        jti?: string;
        data: typeof data;
      }>(cookie, TOKEN_PURPOSE.OAUTH_DATA);

      if (!payload) {
        throw new Error('Invalid OAuth data token');
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

      data = payload.data;
      issuedAtMs = payload.issuedAtMs;
    } catch {
      throw invalidOAuthData();
    }

    // The account carries a second factor, so the round trip bought only the
    // right to present a code. No session exists yet and no cookie is set.
    if ('mfaRequired' in data) {
      return data;
    }

    // The session is issued here and not at the callback: only this request
    // carries the refresh cookie of the session it replaces, which must end
    // before the session limit counts the new one. The account can have been
    // deactivated, deleted or recovered since the callback, and it gets the
    // same refusal as a bad cookie so the exchange leaks no account state.
    // eslint-disable-next-line no-restricted-syntax -- the id comes from the signed, single-use oauth_data cookie that the callback minted
    const user = await this.usersService.findById(data.userId);
    const verdict = signedTokenAccount(user, issuedAtMs);

    if ('refusal' in verdict) {
      // The signed cookie names the account, so the row names it too.
      this.failureAudit.loginFailure(
        {
          provider: data.provider,
          reason: verdict.refusal,
          context: extractAuditContext(req)
        },
        { id: data.userId }
      );

      throw invalidOAuthData();
    }

    return await this.signIn.complete(
      verdict.user,
      { req, res },
      {
        method: 'oauth',
        provider: data.provider
      }
    );
  }

  private async handleOAuthCallback(
    profile: OAuthUserProfile,
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    try {
      // No intent is cleared here: an intent of another flow stays for that
      // flow.
      const flow = claimedFlow(this.cookies.claimedIntents(req));

      switch (flow.kind) {
        case 'reauth':
          return this.handleOAuthReauth(
            { reauthToken: flow.token, profile },
            req,
            res
          );
        case 'link':
          return this.handleOAuthLink(
            { linkToken: flow.token, profile },
            req,
            res
          );
      }

      const result = await this.oauthService.loginWithOAuth(
        profile,
        extractAuditContext(req)
      );

      // No session and no success row yet: /exchange writes both when it
      // finishes the sign-in, and POST /auth/mfa/verify does for a challenge.
      const data =
        'mfaRequired' in result
          ? result
          : { userId: result.id, provider: profile.provider };
      const signedData = this.purposeTokens.sign(
        { data, jti: randomUUID() },
        {
          purpose: TOKEN_PURPOSE.OAUTH_DATA,
          expiresIn: OAuthController.OAUTH_DATA_MAX_AGE_SECONDS
        }
      );

      this.cookies.setShortLived(
        res,
        { base: OAUTH_DATA_COOKIE, value: signedData },
        OAuthController.OAUTH_DATA_MAX_AGE_SECONDS
      );

      res.redirect(`${this.clientUrl}/oauth/callback`);
    } catch (error) {
      this.failureAudit.loginFailure(
        {
          provider: profile.provider,
          reason: oauthFailureReason(error),
          context: extractAuditContext(req)
        },
        error instanceof AccountRefusedException ? { id: error.userId } : null
      );

      logCallbackFailure(this.logger, {
        label: 'OAuth callback error',
        provider: profile.provider,
        error
      });

      if (error instanceof OAuthAuthenticationFailedException) {
        res.redirect(`${this.clientUrl}/login?oauth_error=${error.oauthError}`);

        return;
      }

      res.redirect(
        `${this.clientUrl}/login?oauth_error=${OAUTH_ERROR.AUTH_FAILED}`
      );
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
    {
      reauthToken,
      profile
    }: { reauthToken: string; profile: OAuthUserProfile },
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    this.cookies.clear(res, OAUTH_REAUTH_COOKIE);

    let payload: {
      sub: string;
      email?: string;
      operation?: string;
      issuedAtMs: number;
    } | null = null;

    try {
      payload = this.purposeTokens.verify<{
        sub: string;
        email?: string;
        operation?: string;
      }>(reauthToken, TOKEN_PURPOSE.OAUTH_REAUTH);

      if (!payload) {
        throw new OAuthAuthenticationFailedException(OAUTH_ERROR.REAUTH_FAILED);
      }

      if (!isStepUpOperation(payload.operation)) {
        throw new Error('Re-authentication token names no known operation');
      }

      await this.oauthService.assertReauthenticated(
        payload.sub,
        { provider: profile.provider, providerId: profile.providerId },
        payload.issuedAtMs
      );

      // The id is what the single-use ledger records, so a value captured
      // before the change is refused once the owner has spent it.
      const proof = this.purposeTokens.sign(
        { sub: payload.sub, operation: payload.operation, jti: randomUUID() },
        {
          purpose: TOKEN_PURPOSE.REAUTH_PROOF,
          expiresIn: REAUTH_PROOF_MAX_AGE_SECONDS
        }
      );

      this.cookies.setShortLived(
        res,
        { base: REAUTH_PROOF_COOKIE, value: proof },
        REAUTH_PROOF_MAX_AGE_SECONDS
      );

      res.redirect(`${this.clientUrl}/profile?reauth=ok`);
    } catch (error) {
      this.failureAudit.stepUpFailure(
        {
          provider: profile.provider,
          reason: payload ? oauthFailureReason(error) : INTENT_INVALID_REASON,
          context: extractAuditContext(req)
        },
        payload ?? undefined
      );
      logCallbackFailure(this.logger, {
        label: 'OAuth re-authentication error',
        provider: profile.provider,
        error
      });
      res.redirect(
        `${this.clientUrl}/profile?oauth_error=${OAUTH_ERROR.REAUTH_FAILED}`
      );
    }
  }

  private async handleOAuthLink(
    { linkToken, profile }: { linkToken: string; profile: OAuthUserProfile },
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    this.cookies.clear(res, OAUTH_LINK_COOKIE);

    let account: OAuthIntentAccount | undefined;

    try {
      const payload = this.purposeTokens.verify<{
        sub: string;
        email?: string;
      }>(linkToken, TOKEN_PURPOSE.OAUTH_LINK);

      if (!payload) {
        throw new OAuthAuthenticationFailedException(OAUTH_ERROR.LINK_FAILED);
      }

      account = { sub: payload.sub, email: payload.email };

      await this.oauthService.linkOAuthToUser(
        account.sub,
        { provider: profile.provider, providerId: profile.providerId },
        {
          linkTokenIssuedAtMs: payload.issuedAtMs,
          auditContext: extractAuditContext(req)
        }
      );

      res.redirect(
        `${this.clientUrl}/profile?oauth_linked=${profile.provider}`
      );
    } catch (error) {
      this.failureAudit.linkFailure(
        {
          provider: profile.provider,
          reason: account ? oauthFailureReason(error) : INTENT_INVALID_REASON,
          context: extractAuditContext(req)
        },
        account
      );
      logCallbackFailure(this.logger, {
        label: 'OAuth link error',
        provider: profile.provider,
        error
      });
      res.redirect(
        `${this.clientUrl}/profile?oauth_error=${OAUTH_ERROR.LINK_FAILED}`
      );
    }
  }
}

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Request,
  Res,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../services/auth.service';
import { OAuthAccountService } from '../services/oauth-account.service';
import { GoogleOAuthGuard } from '../guards/google-oauth.guard';
import { FacebookOAuthGuard } from '../guards/facebook-oauth.guard';
import { VkOAuthGuard } from '../guards/vk-oauth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { OAuthUserProfile } from '../types/oauth-profile';
import { JwtAuthRequest } from '../types/auth.request';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';

@ApiTags('OAuth API')
@Controller({
  path: 'auth/oauth',
  version: '1'
})
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);
  private readonly clientUrl: string;

  private static readonly OAUTH_LINK_COOKIE = 'oauth_link';
  private static readonly OAUTH_LINK_MAX_AGE_SECONDS = 300;
  private static readonly OAUTH_DATA_COOKIE = 'oauth_data';
  private static readonly OAUTH_DATA_MAX_AGE_SECONDS = 60;

  constructor(
    private readonly authService: AuthService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService
  ) {
    const url = this.configService.get<string>('CLIENT_URL');
    if (!url) {
      throw new Error('CLIENT_URL environment variable is not configured');
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(
          `CLIENT_URL must use http or https protocol, got: ${parsed.protocol}`
        );
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`CLIENT_URL is not a valid URL: ${url}`);
      }
      throw error;
    }
    this.clientUrl = url;
  }

  // --- Link initiation ---

  @Post('link-init')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate OAuth account linking for current user' })
  initOAuthLink(
    @Request() req: JwtAuthRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const linkToken = this.jwtService.sign(
      { sub: req.user.userId },
      { expiresIn: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS }
    );

    res.cookie(OAuthController.OAUTH_LINK_COOKIE, linkToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('NODE_ENV') === 'production',
      path: '/api/v1/auth/oauth',
      maxAge: OAuthController.OAUTH_LINK_MAX_AGE_SECONDS * 1000
    });

    return { message: 'Link initiated' };
  }

  // --- Google ---

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  googleLogin(): void {
    // Guard redirects to Google
  }

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

  @Get('facebook')
  @UseGuards(FacebookOAuthGuard)
  @ApiOperation({ summary: 'Initiate Facebook OAuth login' })
  facebookLogin(): void {
    // Guard redirects to Facebook
  }

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

  @Get('vk')
  @UseGuards(VkOAuthGuard)
  @ApiOperation({ summary: 'Initiate VK OAuth login' })
  vkLogin(): void {
    // Guard redirects to VK
  }

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
  @UseGuards(JwtAuthGuard)
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

  @Delete('/accounts/:provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink an OAuth provider from current user' })
  @ApiParam({
    name: 'provider',
    enum: OAuthProvider,
    description: 'OAuth provider to unlink'
  })
  async unlinkOAuth(
    @Param('provider') provider: string,
    @Request() req: JwtAuthRequest
  ) {
    if (!Object.values(OAuthProvider).includes(provider as OAuthProvider)) {
      throw new BadRequestException(`Invalid OAuth provider: ${provider}`);
    }

    const userId = req.user.userId;
    const accounts = await this.oauthAccountService.findByUserId(userId);

    const user = await this.usersService.findOne(userId);
    const hasPassword = user.password !== null;
    const otherOAuthCount = accounts.filter(
      (a) => a.provider !== provider
    ).length;

    if (!hasPassword && otherOAuthCount === 0) {
      throw new BadRequestException(
        'Cannot unlink the last OAuth provider without a password set. Please set a password first.'
      );
    }

    await this.oauthAccountService.deleteByUserIdAndProvider(userId, provider);

    await this.auditService.log({
      action: AuditAction.OAUTH_UNLINK,
      actorId: userId,
      actorEmail: req.user.email,
      targetId: userId,
      targetType: 'User',
      details: { provider },
      context: extractAuditContext(req)
    });

    return { message: `${provider} account unlinked successfully` };
  }

  // --- Common callback handler ---

  @Post('exchange')
  @ApiOperation({ summary: 'Exchange OAuth data cookie for auth response' })
  @ApiOkResponse({ description: 'Auth response from OAuth login' })
  exchangeOAuthData(
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
      throw new BadRequestException('Missing OAuth data');
    }

    try {
      const payload = this.jwtService.verify<{ data: unknown }>(cookie);
      return payload.data;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth data');
    }
  }

  private async handleOAuthCallback(
    profile: OAuthUserProfile,
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    try {
      const linkToken = (req.cookies as Record<string, string> | undefined)?.[
        OAuthController.OAUTH_LINK_COOKIE
      ];

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

      const authResponse = await this.authService.loginWithOAuth(profile);

      const signedData = this.jwtService.sign(
        { data: authResponse },
        { expiresIn: OAuthController.OAUTH_DATA_MAX_AGE_SECONDS }
      );

      res.cookie(OAuthController.OAUTH_DATA_COOKIE, signedData, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.configService.get('NODE_ENV') === 'production',
        path: '/api/v1/auth/oauth',
        maxAge: OAuthController.OAUTH_DATA_MAX_AGE_SECONDS * 1000
      });

      res.redirect(`${this.clientUrl}/oauth/callback`);
    } catch (error) {
      this.logger.error('OAuth callback error', error);
      res.redirect(`${this.clientUrl}/login?oauth_error=auth_failed`);
    }
  }

  private async handleOAuthLink(
    linkToken: string,
    profile: OAuthUserProfile,
    req: ExpressRequest,
    res: Response
  ): Promise<void> {
    res.clearCookie(OAuthController.OAUTH_LINK_COOKIE, {
      path: '/api/v1/auth/oauth'
    });

    try {
      const payload = this.jwtService.verify<{ sub: string }>(linkToken);
      const userId = payload.sub;

      await this.authService.linkOAuthToUser(
        userId,
        profile.provider,
        profile.providerId,
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

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
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
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
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

@ApiTags('OAuth API')
@Controller({
  path: 'auth/oauth',
  version: '1'
})
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly oauthAccountService: OAuthAccountService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService
  ) {}

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
    @Request() req: { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, res);
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
    @Request() req: { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, res);
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
    @Request() req: { user: OAuthUserProfile },
    @Res() res: Response
  ) {
    return this.handleOAuthCallback(req.user, res);
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
    return { message: `${provider} account unlinked successfully` };
  }

  // --- Common callback handler ---

  private async handleOAuthCallback(
    profile: OAuthUserProfile,
    res: Response
  ): Promise<void> {
    const clientUrl = this.configService.get<string>('CLIENT_URL');

    try {
      if (!profile.email) {
        this.logger.warn(
          `OAuth login failed: no email provided by ${profile.provider}`
        );
        res.redirect(`${clientUrl}/login?oauth_error=no_email`);
        return;
      }

      const authResponse = await this.authService.loginWithOAuth(profile);

      const encodedData = Buffer.from(JSON.stringify(authResponse)).toString(
        'base64url'
      );

      res.redirect(`${clientUrl}/oauth/callback#data=${encodedData}`);
    } catch (error) {
      this.logger.error('OAuth callback error', error);
      res.redirect(`${clientUrl}/login?oauth_error=auth_failed`);
    }
  }
}

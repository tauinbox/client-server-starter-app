import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Patch,
  Post,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
  UnauthorizedException
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  STEP_UP_OPERATION
} from '@app/shared/constants';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { packRules } from '@casl/ability/extra';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { AuthService } from '../services/auth.service';
import { MfaService } from '../services/mfa.service';
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { MfaPolicyService } from '../services/mfa-policy.service';
import { SYSTEM_ABILITY } from '../casl/app-ability';
import { RegisterDto } from '../dtos/register.dto';
import { UpdateProfileDto } from '../dtos/update-profile.dto';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { LoginDto } from '../dtos/login.dto';
import { Authorize } from '../decorators/authorize.decorator';
import { SkipMfaEnrolmentGate } from '../decorators/skip-mfa-enrolment-gate.decorator';
import { Public } from '../decorators/public.decorator';
import { UsersService } from '../../users/services/users.service';
import { MailService } from '../../mail/mail.service';
import { AuthResponseDto, TokensResponseDto } from '../dtos/auth-response.dto';
import { MfaRequiredResponseDto } from '../dtos/mfa.dto';
import { User } from '../../users/entities/user.entity';
import { JwtAuthRequest, LocalAuthRequest } from '../types/auth.request';
import { VerifyEmailDto } from '../dtos/verify-email.dto';
import { ResendVerificationDto } from '../dtos/resend-verification.dto';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { InitiateEmailChangeDto } from '../dtos/initiate-email-change.dto';
import { ConfirmEmailChangeDto } from '../dtos/confirm-email-change.dto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import type { UserPermissionsResponse } from '@app/shared/types';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { RegisterResource } from '../decorators/register-resource.decorator';
import { Request as ExpressRequest } from 'express';
import { MetricsService } from '../../core/metrics/metrics.service';
import { CaptchaRequiredGuard } from '../captcha/captcha-required.guard';
import {
  OAUTH_INTENT_COOKIE_PATH,
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  REAUTH_PROOF_COOKIE,
  REAUTH_PROOF_COOKIE_PATH
} from '../constants/oauth.constants';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

@ApiTags('Auth API')
@Controller({
  path: 'auth',
  version: '1'
})
@RegisterResource({
  name: 'profile',
  subject: 'Profile',
  displayName: 'Profile'
})
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly userService: UsersService,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly mfaPolicy: MfaPolicyService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService
  ) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
    // getOrThrow: a missing value must fail loudly, not silently downgrade
    // the refresh cookie to a session cookie via a NaN maxAge.
    const maxAge =
      Number(this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION')) *
      1000;
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.get('ENVIRONMENT') === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/v1/auth' });
  }

  // A cookie is identified by name plus path, so the refresh clear above never
  // touches this one. An abandoned link attempt must not outlive the session
  // that started it: the callback links whatever identity signs in next.
  private clearOAuthLinkCookie(res: Response): void {
    res.clearCookie(OAUTH_LINK_COOKIE, { path: OAUTH_INTENT_COOKIE_PATH });
    res.clearCookie(OAUTH_REAUTH_COOKIE, { path: OAUTH_INTENT_COOKIE_PATH });
    res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @UseGuards(CaptchaRequiredGuard)
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User has been successfully registered'
  })
  @ApiConflictResponse({ description: 'User with this email already exists' })
  register(@Body() registerDto: RegisterDto, @Request() req: ExpressRequest) {
    return this.authService.register(registerDto, extractAuditContext(req));
  }

  @Public()
  @Throttle({
    default: { ttl: 60000, limit: 3 },
    'login-long-window': {
      ttl: LOCKOUT_DURATION_MS,
      limit: MAX_FAILED_ATTEMPTS - 1
    }
  })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'User has been successfully logged in',
    type: AuthResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(
    @Request() req: LocalAuthRequest,
    @Res({ passthrough: true }) res: Response
  ): Promise<
    | MfaRequiredResponseDto
    | { tokens: Omit<TokensResponseDto, 'refresh_token'>; user: User }
  > {
    // An account carrying a second factor is not signed in yet, so a correct
    // password buys only the right to present a code: no session cookie and no
    // success entry. POST /auth/mfa/verify finishes both.
    if (req.user.totpEnabledAt) {
      const { mfaToken, expiresIn } = this.mfaService.issuePendingToken(
        req.user
      );
      return { mfaRequired: true, mfaToken, expiresIn };
    }

    const result = await this.authService.login(req.user);
    await this.auditService.log({
      action: AuditAction.USER_LOGIN_SUCCESS,
      actorId: req.user.id,
      actorEmail: req.user.email,
      targetId: req.user.id,
      targetType: 'User',
      context: extractAuditContext(req)
    });
    this.metricsService.recordAuthEvent('login_success');

    const { refresh_token, ...publicTokens } = result.tokens;
    this.setRefreshTokenCookie(res, refresh_token);
    return { tokens: publicTokens, user: result.user };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using a refresh cookie' })
  @ApiOkResponse({
    description: 'Tokens have been refreshed',
    type: AuthResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  async refreshToken(
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_TOKEN_COOKIE
    ];
    if (!cookieToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const result = await this.authService.refreshTokens(cookieToken);
    const { refresh_token, ...publicTokens } = result.tokens;
    this.setRefreshTokenCookie(res, refresh_token);
    return { tokens: publicTokens, user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh tokens' })
  @ApiOkResponse({ description: 'Successfully logged out' })
  async logout(
    @Request() req: JwtAuthRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.logout(req.user.userId);
    this.clearRefreshTokenCookie(res);
    this.clearOAuthLinkCookie(res);
    await this.auditService.log({
      action: AuditAction.USER_LOGOUT,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      context: extractAuditContext(req)
    });
    this.metricsService.recordAuthEvent('logout');
    return { message: 'Successfully logged out' };
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({
    description: 'Current user profile',
    type: UserResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getProfile(@Request() req: JwtAuthRequest) {
    return await this.userService.findOne(req.user.userId);
  }

  @Authorize(['update', 'Profile'])
  // The two-factor gate shuts the administration surface, never the account's
  // own credentials: an account with no password sets one here before it can
  // satisfy the step-up that enrolment needs.
  @SkipMfaEnrolmentGate()
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current user profile' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({
    description: 'Profile has been successfully updated',
    type: UserResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateProfile(
    @Request() req: JwtAuthRequest,
    @Body() updateProfileDto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const reauthProof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];

    if (updateProfileDto.password) {
      // A first password binds a credential that outlives the session, so it
      // needs the same fresh proof of identity an email change needs.
      await this.authService.assertStepUpForUser(
        req.user.userId,
        updateProfileDto.currentPassword,
        reauthProof,
        STEP_UP_OPERATION.PASSWORD_SET
      );
    }

    const { currentPassword: _ignored, ...updatePayload } = updateProfileDto;
    // Self-service route: the target is pinned to the authenticated caller and
    // the route is already gated by @Authorize(['update', 'Profile']), so no
    // instance-level check on another user's record can apply here.
    const updatedUser = await this.userService.update(
      req.user.userId,
      updatePayload,
      SYSTEM_ABILITY
    );

    if (updateProfileDto.password) {
      await this.authService.logout(req.user.userId);
      this.clearRefreshTokenCookie(res);
      this.clearOAuthLinkCookie(res);
      // Cleared only now, so a rejected attempt keeps its remaining proof
      // window. The logout above already ends the session that carried it.
      res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });
      await this.auditService.log({
        action: AuditAction.PASSWORD_CHANGE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: req.user.userId,
        targetType: 'User',
        details: { source: 'self' },
        context: extractAuditContext(req)
      });

      this.mailService
        .sendPasswordChangedNotification(
          updatedUser.email,
          'self',
          updatedUser.locale,
          req.ip
        )
        .catch((err) =>
          this.logger.error('Failed to send password-changed notification', err)
        );
    }

    return updatedUser;
  }

  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @Post('profile/email/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a self-service email change' })
  @ApiBody({ type: InitiateEmailChangeDto })
  @ApiOkResponse({
    description:
      'If the new email is available, a confirmation link has been sent to it'
  })
  async initiateEmailChange(
    @Request() req: JwtAuthRequest,
    @Body() dto: InitiateEmailChangeDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const proof = (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];

    const result = await this.authService.initiateEmailChange(
      req.user.userId,
      dto,
      proof,
      extractAuditContext(req)
    );

    // Cleared only after the change is accepted, so a rejected attempt leaves
    // the user their remaining proof window instead of a second round trip.
    res.clearCookie(REAUTH_PROOF_COOKIE, { path: REAUTH_PROOF_COOKIE_PATH });

    return result;
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('profile/email/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a self-service email change' })
  @ApiBody({ type: ConfirmEmailChangeDto })
  @ApiOkResponse({ description: 'Email has been updated' })
  confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @Request() req: ExpressRequest
  ) {
    return this.authService.confirmEmailChange(
      dto.token,
      extractAuditContext(req)
    );
  }

  @Get('permissions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user permissions' })
  @ApiOkResponse({ description: 'User permissions' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getPermissions(
    @Request() req: JwtAuthRequest
  ): Promise<UserPermissionsResponse> {
    const [roles, permissions, mfaMandatory] = await Promise.all([
      this.permissionService.getRolesForUser(req.user.userId),
      this.permissionService.getPermissionsForUser(req.user.userId),
      this.mfaPolicy.appliesTo(req.user.userId)
    ]);
    const ability = await this.caslAbilityFactory.createForUser(
      req.user.userId,
      roles,
      permissions
    );
    const roleNames = roles.map((r) => r.name);
    return {
      roles: roleNames,
      rules: packRules(ability.rules),
      mfaMandatory
    };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using token' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiOkResponse({ description: 'Email verified successfully' })
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiBody({ type: ResendVerificationDto })
  @ApiOkResponse({ description: 'Verification email sent if account exists' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Public()
  @Throttle({ default: { ttl: 300000, limit: 2 } })
  @UseGuards(CaptchaRequiredGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Password reset email sent if account exists' })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Request() req: ExpressRequest
  ) {
    return this.authService.forgotPassword(dto.email, extractAuditContext(req));
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Password has been reset successfully' })
  resetPassword(@Body() dto: ResetPasswordDto, @Request() req: ExpressRequest) {
    return this.authService.resetPassword(
      dto.token,
      dto.password,
      extractAuditContext(req)
    );
  }
}

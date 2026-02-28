import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { PermissionService } from '../services/permission.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { RegisterDto } from '../dtos/register.dto';
import { UpdateProfileDto } from '../dtos/update-profile.dto';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { LoginDto } from '../dtos/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UsersService } from '../../users/services/users.service';
import { AuthResponseDto } from '../dtos/auth-response.dto';
import { JwtAuthRequest, LocalAuthRequest } from '../types/auth.request';
import { VerifyEmailDto } from '../dtos/verify-email.dto';
import { ResendVerificationDto } from '../dtos/resend-verification.dto';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { Request as ExpressRequest } from 'express';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

@ApiTags('Auth API')
@Controller({
  path: 'auth',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UsersService,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService
  ) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
    const maxAge =
      Number(this.configService.get<string>('JWT_REFRESH_EXPIRATION')) * 1000;
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

  @Throttle({ default: { ttl: 3600000, limit: 5 } })
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

  @Throttle({ default: { ttl: 60000, limit: 3 } })
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
  ) {
    const result = await this.authService.login(req.user);
    await this.auditService.log({
      action: AuditAction.USER_LOGIN_SUCCESS,
      actorId: req.user.id,
      actorEmail: req.user.email,
      targetId: req.user.id,
      targetType: 'User',
      context: extractAuditContext(req)
    });

    const { refresh_token, ...publicTokens } = result.tokens;
    this.setRefreshTokenCookie(res, refresh_token);
    return { tokens: publicTokens, user: result.user };
  }

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

  @UseGuards(JwtAuthGuard)
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
    await this.auditService.log({
      action: AuditAction.USER_LOGOUT,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      context: extractAuditContext(req)
    });
    return { message: 'Successfully logged out' };
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
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
    const updatedUser = await this.userService.update(
      req.user.userId,
      updateProfileDto
    );

    if (updateProfileDto.password) {
      await this.authService.logout(req.user.userId);
      this.clearRefreshTokenCookie(res);
      await this.auditService.log({
        action: AuditAction.PASSWORD_CHANGE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: req.user.userId,
        targetType: 'User',
        details: { source: 'self' },
        context: extractAuditContext(req)
      });
    }

    return updatedUser;
  }

  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user permissions' })
  @ApiOkResponse({ description: 'User permissions' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getPermissions(@Request() req: JwtAuthRequest) {
    const [roles, permissions] = await Promise.all([
      this.permissionService.getRoleNamesForUser(req.user.userId),
      this.permissionService.getPermissionsForUser(req.user.userId)
    ]);
    const ability = this.caslAbilityFactory.createForUser(
      req.user.userId,
      roles,
      permissions
    );
    return { roles, rules: packRules(ability.rules) };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using token' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiOkResponse({ description: 'Email verified successfully' })
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiBody({ type: ResendVerificationDto })
  @ApiOkResponse({ description: 'Verification email sent if account exists' })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Throttle({ default: { ttl: 300000, limit: 2 } })
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

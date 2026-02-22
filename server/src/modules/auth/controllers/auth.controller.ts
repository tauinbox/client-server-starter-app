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
  UseGuards,
  UseInterceptors
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
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { RegisterDto } from '../dtos/register.dto';
import { UpdateProfileDto } from '../dtos/update-profile.dto';
import { UserResponseDto } from '../../users/dtos/user-response.dto';
import { LoginDto } from '../dtos/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UsersService } from '../../users/services/users.service';
import { AuthResponseDto, RefreshTokenDto } from '../dtos/auth-response.dto';
import { JwtAuthRequest, LocalAuthRequest } from '../types/auth.request';
import { VerifyEmailDto } from '../dtos/verify-email.dto';
import { ResendVerificationDto } from '../dtos/resend-verification.dto';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';

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
    private readonly permissionService: PermissionService
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User has been successfully registered'
  })
  @ApiConflictResponse({ description: 'User with this email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
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
  login(@Request() req: LocalAuthRequest) {
    return this.authService.login(req.user);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using a refresh token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'Tokens have been refreshed',
    type: AuthResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate refresh tokens' })
  @ApiOkResponse({ description: 'Successfully logged out' })
  async logout(@Request() req: JwtAuthRequest) {
    await this.authService.logout(req.user.userId);
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
    @Body() updateProfileDto: UpdateProfileDto
  ) {
    const updatedUser = await this.userService.update(
      req.user.userId,
      updateProfileDto
    );

    if (updateProfileDto.password) {
      await this.authService.logout(req.user.userId);
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
    return { roles, permissions };
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

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Password reset email sent if account exists' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Password has been reset successfully' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }
}

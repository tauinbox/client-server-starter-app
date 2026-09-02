import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request as ExpressRequest, Response } from 'express';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuthService } from '../services/auth.service';
import { MfaService } from '../services/mfa.service';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { Public } from '../decorators/public.decorator';
import { JwtAuthRequest } from '../types/auth.request';
import { User } from '../../users/entities/user.entity';
import { AuthResponseDto } from '../dtos/auth-response.dto';
import {
  MfaDisableDto,
  MfaEnableDto,
  MfaRecoveryCodesResponseDto,
  MfaRecoveryDto,
  MfaSetupDto,
  MfaSetupResponseDto,
  MfaVerifyDto
} from '../dtos/mfa.dto';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { REAUTH_PROOF_COOKIE } from '../constants/oauth.constants';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * A wrong code must cost the attacker something: six digits is a million
 * guesses, which an unthrottled route walks in minutes. The long window is the
 * same one the login route uses, and it refunds itself on success, so only
 * failures accumulate.
 */
const CHALLENGE_THROTTLE = {
  default: { ttl: 60000, limit: 5 },
  'login-long-window': {
    ttl: LOCKOUT_DURATION_MS,
    limit: MAX_FAILED_ATTEMPTS - 1
  }
};

@ApiTags('Auth API')
@Controller({
  path: 'auth/mfa',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class MfaController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly userService: UsersService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService
  ) {}

  private setRefreshTokenCookie(res: Response, token: string): void {
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

  private reauthProof(req: ExpressRequest): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[
      REAUTH_PROOF_COOKIE
    ];
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a two-factor enrolment' })
  @ApiBody({ type: MfaSetupDto })
  @ApiOkResponse({
    description: 'Secret and QR code for the authenticator app',
    type: MfaSetupResponseDto
  })
  @ApiConflictResponse({ description: 'Two-factor is already enabled' })
  async setup(
    @Request() req: JwtAuthRequest,
    @Body() dto: MfaSetupDto
  ): Promise<MfaSetupResponseDto> {
    const user = await this.userService.findOne(req.user.userId);
    // A stolen session must not be able to enrol a device of its own, which
    // would lock the owner out of their own account.
    await this.authService.assertStepUp(
      user,
      dto.currentPassword,
      this.reauthProof(req)
    );

    return await this.mfaService.beginEnrolment(user);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm the authenticator and turn two-factor on' })
  @ApiBody({ type: MfaEnableDto })
  @ApiOkResponse({
    description: 'Recovery codes, readable only in this response',
    type: MfaRecoveryCodesResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Verification code is incorrect' })
  async enable(
    @Request() req: JwtAuthRequest,
    @Body() dto: MfaEnableDto
  ): Promise<MfaRecoveryCodesResponseDto> {
    const user = await this.userService.findOne(req.user.userId);
    return await this.mfaService.completeEnrolment(
      user,
      dto.code,
      extractAuditContext(req)
    );
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Turn two-factor off' })
  @ApiBody({ type: MfaDisableDto })
  @ApiOkResponse({ description: 'Two-factor has been turned off' })
  async disable(
    @Request() req: JwtAuthRequest,
    @Body() dto: MfaDisableDto
  ): Promise<{ message: string }> {
    const user = await this.userService.findOne(req.user.userId);
    await this.authService.assertStepUp(
      user,
      dto.currentPassword,
      this.reauthProof(req),
      dto.code
    );

    await this.mfaService.disable(user, extractAuditContext(req));
    return { message: 'Two-factor authentication has been turned off' };
  }

  @Public()
  @Throttle(CHALLENGE_THROTTLE)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish a sign-in with an authenticator code' })
  @ApiBody({ type: MfaVerifyDto })
  @ApiOkResponse({
    description: 'User has been successfully logged in',
    type: AuthResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Verification code is incorrect' })
  async verify(
    @Request() req: ExpressRequest,
    @Body() dto: MfaVerifyDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const user = await this.mfaService.verifyChallenge(
      dto.mfaToken,
      dto.code,
      extractAuditContext(req)
    );

    return await this.issueSession(user, req, res);
  }

  @Public()
  @Throttle(CHALLENGE_THROTTLE)
  @Post('recovery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish a sign-in with a recovery code' })
  @ApiBody({ type: MfaRecoveryDto })
  @ApiOkResponse({
    description: 'User has been successfully logged in',
    type: AuthResponseDto
  })
  @ApiUnauthorizedResponse({ description: 'Recovery code is not usable' })
  async recovery(
    @Request() req: ExpressRequest,
    @Body() dto: MfaRecoveryDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const user = await this.mfaService.consumeRecoveryCode(
      dto.mfaToken,
      dto.recoveryCode,
      extractAuditContext(req)
    );

    return await this.issueSession(user, req, res);
  }

  /**
   * The second factor is the last gate, so the sign-in is only complete here.
   * The audit entry and the metric belong to this point rather than to the
   * password check that preceded it.
   */
  private async issueSession(user: User, req: ExpressRequest, res: Response) {
    const result = await this.authService.login(user);

    await this.auditService.log({
      action: AuditAction.USER_LOGIN_SUCCESS,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      details: { factor: 'mfa' },
      context: extractAuditContext(req)
    });
    this.metricsService.recordAuthEvent('login_success');

    const { refresh_token, ...publicTokens } = result.tokens;
    this.setRefreshTokenCookie(res, refresh_token);
    return { tokens: publicTokens, user: result.user };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Request,
  Res
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request as ExpressRequest, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ErrorKeys,
  requiresSecureCookies,
  STEP_UP_OPERATION
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuthService } from '../services/auth.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UsersService } from '../../users/services/users.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthRequest } from '../types/auth.request';
import { MfaStepUpDto } from '../dtos/mfa.dto';
import { ActiveSessionResponseDto } from '../dtos/active-session-response.dto';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { REAUTH_PROOF_COOKIE } from '../constants/oauth.constants';
import {
  clearHostCookie,
  readHostCookie
} from '../../../common/utils/host-cookie';
import { CHALLENGE_THROTTLE } from '../constants/throttle.constants';
import { CountFailuresOnlyWhenBody } from '../../core/failure-counter.decorator';

/**
 * The signed-in devices of the caller. The list is bounded by the plan
 * allowance that prunes sessions at sign-in, so it is returned whole rather
 * than through a cursor.
 *
 * Ending a session demands a step-up, the same one the credential routes
 * demand: a stolen access token alone must not be able to evict the owner.
 */
@ApiTags('Auth API')
@Controller({
  path: 'auth/sessions',
  version: '1'
})
export class SessionsController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly userService: UsersService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService
  ) {}

  private get secureCookies(): boolean {
    return requiresSecureCookies(this.configService.get<string>('ENVIRONMENT'));
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the signed-in devices of the current user' })
  @ApiOkResponse({ type: ActiveSessionResponseDto, isArray: true })
  async list(
    @Request() req: JwtAuthRequest
  ): Promise<ActiveSessionResponseDto[]> {
    const rows = await this.refreshTokenService.findLiveSessions(
      req.user.userId
    );

    return rows.map((row) => ({
      id: row.sessionId,
      current: row.sessionId === req.user.sessionId,
      userAgent: row.userAgent,
      startedAt: row.sessionStartedAt.toISOString(),
      lastActiveAt: row.createdAt.toISOString()
    }));
  }

  /**
   * The session of the calling device is refused: ending it here would leave
   * the refresh cookie in the browser, and the sign-out route already ends it
   * and clears the cookie.
   */
  @Throttle(CHALLENGE_THROTTLE)
  @CountFailuresOnlyWhenBody('currentPassword', 'code')
  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End one other session of the current user' })
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiBody({ type: MfaStepUpDto, required: false })
  @ApiOkResponse({ description: 'The session has ended' })
  @ApiNotFoundResponse({ description: 'No such session for this user' })
  async revokeOne(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Request() req: JwtAuthRequest,
    @Body() dto: MfaStepUpDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ message: string }> {
    // Ahead of the step-up: the caller already knows its own session id, and a
    // request refused anyway must not spend a single-use provider proof.
    if (sessionId === req.user.sessionId) {
      throw new HttpException(
        {
          message: 'Use sign out to end the session of this device',
          errorKey: ErrorKeys.AUTH.SESSION_IS_CURRENT
        },
        HttpStatus.BAD_REQUEST
      );
    }

    await this.assertStepUp(req, dto);

    const ended = await this.refreshTokenService.deleteUserSession(
      req.user.userId,
      sessionId
    );
    if (!ended) {
      throw new HttpException(
        {
          message: 'Session not found',
          errorKey: ErrorKeys.AUTH.SESSION_NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }

    this.clearReauthProofCookie(res);
    await this.logRevoke(req, 'one', 1);
    return { message: 'Session has ended' };
  }

  @Throttle(CHALLENGE_THROTTLE)
  @CountFailuresOnlyWhenBody('currentPassword', 'code')
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'End every session of the current user except this one'
  })
  @ApiBody({ type: MfaStepUpDto, required: false })
  @ApiOkResponse({ description: 'Every other session has ended' })
  async revokeOthers(
    @Request() req: JwtAuthRequest,
    @Body() dto: MfaStepUpDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ message: string; count: number }> {
    await this.assertStepUp(req, dto);

    const count = await this.refreshTokenService.deleteOtherSessions(
      req.user.userId,
      req.user.sessionId
    );

    this.clearReauthProofCookie(res);
    await this.logRevoke(req, 'others', count);
    return { message: 'Other sessions have ended', count };
  }

  /**
   * Runs before the session lookup, so a caller without a fresh proof learns
   * nothing about which session ids exist.
   */
  private async assertStepUp(
    req: JwtAuthRequest,
    dto: MfaStepUpDto
  ): Promise<void> {
    const user = await this.userService.findOne(req.user.userId);
    await this.authService.assertStepUp(
      user,
      dto.currentPassword,
      this.reauthProof(req),
      STEP_UP_OPERATION.SESSION_REVOKE,
      dto.code,
      extractAuditContext(req)
    );
  }

  private reauthProof(req: ExpressRequest): string | undefined {
    return readHostCookie(req, REAUTH_PROOF_COOKIE, this.secureCookies);
  }

  /**
   * Called only after the change is accepted, so a rejected attempt keeps its
   * remaining proof window. The ledger already refuses a second use.
   */
  private clearReauthProofCookie(res: Response): void {
    clearHostCookie(res, REAUTH_PROOF_COOKIE, this.secureCookies);
  }

  /** The device label is client data, so it never enters the audit row. */
  private async logRevoke(
    req: JwtAuthRequest,
    scope: 'one' | 'others',
    count: number
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.SESSION_REVOKE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: req.user.userId,
      targetType: 'User',
      details: { scope, count },
      context: extractAuditContext(req)
    });
  }
}

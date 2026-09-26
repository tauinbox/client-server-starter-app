import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { TokensResponseDto } from '../dtos/auth-response.dto';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { normalizeUserAgent } from '../../../common/utils/user-agent.util';
import { AuthCookies } from '../utils/auth-cookies';
import { AuthService } from './auth.service';

/**
 * The last step of every sign-in (password, second factor and the OAuth
 * exchange), so they can never drift.
 *
 * Not part of SessionIssuerService, because AuthService already depends on
 * that one and this step calls AuthService.
 */
@Injectable()
export class SignInCompletionService {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly cookies: AuthCookies
  ) {}

  async complete(
    user: User,
    req: Request,
    res: Response,
    details?: Record<string, unknown>
  ): Promise<{ tokens: Omit<TokensResponseDto, 'refresh_token'>; user: User }> {
    // Before the new session exists, so the session limit prunes against a
    // count that no longer holds the session this browser is replacing.
    await this.authService.endPresentedSession(this.cookies.readRefresh(req));
    const result = await this.authService.login(
      user,
      normalizeUserAgent(req.headers['user-agent'])
    );

    await this.auditService.log({
      action: AuditAction.USER_LOGIN_SUCCESS,
      actorId: user.id,
      actorEmail: user.email,
      targetId: user.id,
      targetType: 'User',
      ...(details && { details }),
      context: extractAuditContext(req)
    });
    this.metricsService.recordAuthEvent('login_success');

    const { refresh_token, ...publicTokens } = result.tokens;
    this.cookies.setRefresh(res, refresh_token);
    return { tokens: publicTokens, user: result.user };
  }
}

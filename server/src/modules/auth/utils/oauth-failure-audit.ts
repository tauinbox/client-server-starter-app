import { Injectable } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { TOKEN_PURPOSE, type TokenPurpose } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { PurposeTokenService } from '../services/purpose-token.service';
import type { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import { AuthCookies, claimedFlow } from './auth-cookies';

/** The account that a verified intent cookie names. */
export interface OAuthIntentAccount {
  sub: string;
  email?: string;
}

export interface ReauthIntentAccount extends OAuthIntentAccount {
  operation?: string;
}

export interface OAuthFailure {
  provider?: string;
  reason: string;
  context: AuditContext;
}

/**
 * The audit rows of a refused provider callback. The callback handler and the
 * exception filter of the provider guard both write through this class, so a
 * refusal gets the same row at either layer. No field of the provider profile
 * beyond its name enters a row: the address is the claim of the provider, not
 * an identity this server verified.
 */
@Injectable()
export class OAuthFailureAudit {
  constructor(
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    private readonly purposeTokens: PurposeTokenService,
    private readonly cookies: AuthCookies
  ) {}

  /**
   * `target` is the account that the server found from a value it trusts: a
   * verified linked identity or a token it signed. A refusal that rests on the
   * address of the provider profile names no account, so it passes null.
   */
  loginFailure(
    { provider, reason, context }: OAuthFailure,
    target: { id: string } | null
  ): void {
    this.auditService.logFireAndForget({
      action: AuditAction.USER_LOGIN_FAILURE,
      ...(target && { targetId: target.id, targetType: 'User' }),
      details: { method: 'oauth', provider, reason },
      context
    });
    this.metricsService.recordAuthEvent('login_failure');
  }

  /** With no account, the intent did not verify, so the row has no actor. */
  stepUpFailure(
    { provider, reason, context }: OAuthFailure,
    account?: ReauthIntentAccount
  ): void {
    this.auditService.logFireAndForget({
      action: AuditAction.STEP_UP_FAILURE,
      ...actorFields(account),
      details: {
        operation: account?.operation,
        factor: 'reauth_proof',
        provider,
        reason
      },
      context
    });
  }

  /** With no account, the intent did not verify, so the row has no actor. */
  linkFailure(
    { provider, reason, context }: OAuthFailure,
    account?: OAuthIntentAccount
  ): void {
    this.auditService.logFireAndForget({
      action: AuditAction.OAUTH_LINK_FAILURE,
      ...actorFields(account),
      details: { provider, reason },
      context
    });
  }

  /**
   * A failure at the provider guard. The intent that this flow claimed selects
   * the row, as it selects the redirect of the guard and the handler of the
   * callback. Only an intent that verifies puts an actor on the row: an
   * expired intent is still a step-up or a link attempt of this browser.
   */
  guardFailure(
    req: ExpressRequest,
    exception: OAuthAuthenticationFailedException
  ): void {
    const failure: OAuthFailure = {
      provider: exception.provider,
      reason: exception.oauthError,
      context: extractAuditContext(req)
    };

    const flow = claimedFlow(this.cookies.claimedIntents(req));

    switch (flow.kind) {
      case 'reauth':
        this.stepUpFailure(
          failure,
          this.verifiedAccount<ReauthIntentAccount>(
            flow.token,
            TOKEN_PURPOSE.OAUTH_REAUTH
          )
        );

        return;
      case 'link':
        this.linkFailure(
          failure,
          this.verifiedAccount<OAuthIntentAccount>(
            flow.token,
            TOKEN_PURPOSE.OAUTH_LINK
          )
        );

        return;
      case 'login':
        this.loginFailure(failure, null);
    }
  }

  private verifiedAccount<T extends OAuthIntentAccount>(
    token: string,
    purpose: TokenPurpose
  ): T | undefined {
    return this.purposeTokens.verify<T>(token, purpose) ?? undefined;
  }
}

function actorFields(account: OAuthIntentAccount | undefined) {
  if (!account) {
    return {};
  }

  return {
    actorId: account.sub,
    actorEmail: account.email,
    targetId: account.sub,
    targetType: 'User'
  };
}

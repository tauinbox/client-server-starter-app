import { Injectable } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { TOKEN_PURPOSE, type TokenPurpose } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { PurposeTokenService } from '../services/purpose-token.service';
import type { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import { AuthCookies } from './auth-cookies';

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

  loginFailure({ provider, reason, context }: OAuthFailure): void {
    this.auditService.logFireAndForget({
      action: AuditAction.USER_LOGIN_FAILURE,
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
   * A failure at the provider guard. Only an intent that this flow claimed and
   * that verifies makes the row a step-up or a link row; the callback handler
   * reads the intents in the same order. Every other case is a refused sign-in.
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

    const { reauth, link } = this.cookies.claimedIntents(req);

    const reauthAccount = this.verifiedAccount<ReauthIntentAccount>(
      reauth,
      TOKEN_PURPOSE.OAUTH_REAUTH
    );

    if (reauthAccount) {
      this.stepUpFailure(failure, reauthAccount);

      return;
    }

    const linkAccount = this.verifiedAccount<OAuthIntentAccount>(
      link,
      TOKEN_PURPOSE.OAUTH_LINK
    );

    if (linkAccount) {
      this.linkFailure(failure, linkAccount);

      return;
    }

    this.loginFailure(failure);
  }

  private verifiedAccount<T extends OAuthIntentAccount>(
    token: string | null,
    purpose: TokenPurpose
  ): T | null {
    return token ? this.purposeTokens.verify<T>(token, purpose) : null;
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

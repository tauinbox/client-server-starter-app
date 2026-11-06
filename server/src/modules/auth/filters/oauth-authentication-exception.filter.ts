import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CLIENT_URL } from '../providers/client-url.provider';
import { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import {
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE
} from '../constants/oauth.constants';
import { AuthCookies } from '../utils/auth-cookies';
import { OAuthFailureAudit } from '../utils/oauth-failure-audit';

@Injectable()
@Catch(OAuthAuthenticationFailedException)
export class OAuthAuthenticationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthAuthenticationExceptionFilter.name);

  constructor(
    @Inject(CLIENT_URL) private readonly clientUrl: string,
    private readonly cookies: AuthCookies,
    private readonly failureAudit: OAuthFailureAudit
  ) {}

  catch(
    exception: OAuthAuthenticationFailedException,
    host: ArgumentsHost
  ): void {
    const reason =
      exception.reason instanceof Error ? `: ${exception.reason.message}` : '';

    this.logger.warn(`${exception.message}${reason}`);

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    this.failureAudit.guardFailure(request, exception);

    // The attempt of this flow is over, so its intent goes, as OAuthController
    // clears it on the success and in-handler failure paths. An intent of
    // another flow stays: that flow may still finish in another tab.
    const { link, reauth } = this.cookies.claimedIntents(request);

    if (link !== null) {
      this.cookies.clear(response, OAUTH_LINK_COOKIE);
    }

    if (reauth !== null) {
      this.cookies.clear(response, OAUTH_REAUTH_COOKIE);
    }

    response.redirect(
      `${this.clientUrl}${exception.redirectPath}?oauth_error=${exception.oauthError}`
    );
  }
}

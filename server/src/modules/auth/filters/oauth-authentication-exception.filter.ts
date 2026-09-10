import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { CLIENT_URL } from '../providers/client-url.provider';
import { OAuthAuthenticationFailedException } from '../exceptions/oauth-authentication-failed.exception';
import {
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE,
  OAUTH_INTENT_COOKIE_PATH
} from '../constants/oauth.constants';

@Injectable()
@Catch(OAuthAuthenticationFailedException)
export class OAuthAuthenticationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthAuthenticationExceptionFilter.name);

  constructor(@Inject(CLIENT_URL) private readonly clientUrl: string) {}

  catch(
    exception: OAuthAuthenticationFailedException,
    host: ArgumentsHost
  ): void {
    const reason =
      exception.reason instanceof Error ? `: ${exception.reason.message}` : '';
    this.logger.warn(`${exception.message}${reason}`);

    const response = host.switchToHttp().getResponse<Response>();

    // The attempt is over, so neither intent cookie must survive to turn the
    // user's next plain OAuth login into another link or step-up attempt. The
    // success and in-handler failure paths clear them in OAuthController the
    // same way. Only one of the two is normally present.
    if (exception.redirectPath === '/profile') {
      response.clearCookie(OAUTH_LINK_COOKIE, {
        path: OAUTH_INTENT_COOKIE_PATH
      });
      response.clearCookie(OAUTH_REAUTH_COOKIE, {
        path: OAUTH_INTENT_COOKIE_PATH
      });
    }

    response.redirect(
      `${this.clientUrl}${exception.redirectPath}?oauth_error=${exception.oauthError}`
    );
  }
}

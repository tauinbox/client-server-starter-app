import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Injection token for the validated CLIENT_URL. Both the OAuth controller and
 * the OAuth failure filter build browser redirects from it, so it is validated
 * once at startup rather than separately in each consumer.
 */
export const CLIENT_URL = Symbol('CLIENT_URL');

export function validateClientUrl(url: string | undefined): string {
  if (!url) {
    throw new Error('CLIENT_URL environment variable is not configured');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`CLIENT_URL is not a valid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(
      `CLIENT_URL must use http or https protocol, got: ${parsed.protocol}`
    );
  }
  return url;
}

export const clientUrlProvider: Provider = {
  provide: CLIENT_URL,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): string =>
    validateClientUrl(configService.get<string>('CLIENT_URL'))
};

import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * JSON is the only body type the API reads. A form body is the one type a
 * cross-site HTML form can send without a CORS preflight, so a login posted
 * that way would plant the sender's session in the browser of whoever opened
 * the page. Nest registers a urlencoded parser unless `bodyParser` is false.
 *
 * `rawBody` keeps the unparsed bytes for the webhook signature checks; the
 * parser registered below inherits it from these options.
 */
export const HTTP_BODY_APP_OPTIONS: NestApplicationOptions = {
  rawBody: true,
  bodyParser: false
};

export function applyBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '100kb' });
}

import type { Params } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import type { LogFn } from 'pino';
import { maskEmail } from '../../common/utils/escape-html';

// Bounded quantifiers (RFC 5321 length limits) keep the scan linear, and the
// alphabetic TLD keeps `pkg@1.2.3` and `node_modules/@scope` in a stack intact.
const EMAIL_IN_TEXT =
  /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,63}/g;

export function maskEmailsInText(text: string): string {
  return text.includes('@')
    ? text.replace(EMAIL_IN_TEXT, (email) => maskEmail(email))
    : text;
}

/**
 * The Nest logger hands every argument after the message to pino as a printf
 * value, and pino drops a value that has no placeholder, so
 * `logger.error('msg', err)` would write no cause and no stack. Move the first
 * Error after the message into `err` instead.
 */
export function moveErrorArgToErrKey(args: unknown[]): unknown[] {
  const [bindings, message, ...rest] = args;
  if (typeof message !== 'string') return args;

  const errorIndex = rest.findIndex((arg) => arg instanceof Error);
  if (errorIndex === -1) return args;

  const base =
    typeof bindings === 'object' && bindings !== null ? bindings : {};
  if ('err' in base) return args;

  return [
    { ...base, err: rest[errorIndex] },
    message,
    ...rest.filter((_, index) => index !== errorIndex)
  ];
}

interface SerializedError {
  type?: string;
  message?: string;
  stack?: string;
  code?: string | number;
}

/**
 * The standard pino error serializer copies every enumerable field of the
 * error. Those fields carry secrets and PII: TypeORM
 * `QueryFailedError.parameters`, the axios request `config` with its Basic
 * auth header, and SMTP replies that quote the recipient address. Keep only an
 * allowlist, and mask addresses in the text that remains. Add a field here
 * only after you confirm that it cannot carry PII or a secret.
 *
 * pino-http runs the standard serializer before this one, but the logger that
 * nestjs-pino uses outside a request is plain pino and passes the raw Error.
 */
export function serializeLoggedError(value: unknown): unknown {
  if (typeof value === 'string') return maskEmailsInText(value);
  if (typeof value !== 'object' || value === null) return value;

  const source = (
    value instanceof Error ? stdSerializers.err(value) : value
  ) as Record<string, unknown>;
  const result: SerializedError = {};
  if (typeof source['type'] === 'string') result.type = source['type'];
  if (typeof source['message'] === 'string') {
    result.message = maskEmailsInText(source['message']);
  }
  if (typeof source['stack'] === 'string') {
    result.stack = maskEmailsInText(source['stack']);
  }
  const code = source['code'];
  if (typeof code === 'string' || typeof code === 'number') result.code = code;
  return result;
}

export function buildLoggerOptions(environment: string | undefined): Params {
  const production = environment === 'production';
  return {
    pinoHttp: {
      // HTTP request logging is handled by RequestLoggingMiddleware
      autoLogging: false,
      level: production ? 'info' : 'debug',
      hooks: {
        logMethod(args, method) {
          method.apply(this, moveErrorArgToErrKey(args) as Parameters<LogFn>);
        }
      },
      serializers: { err: serializeLoggedError },
      transport: production
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true }
          }
    }
  };
}

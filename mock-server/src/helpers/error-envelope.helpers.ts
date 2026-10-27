import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import {
  ERROR_STATUS,
  ErrorKeys,
  httpStatusText,
  type ErrorKey
} from '@app/shared/constants';

const FORWARDED_FIELDS = [
  'errors',
  'errorKey',
  'lockedUntil',
  'retryAfter'
] as const;

// Mirrors `INVALID_TOKEN_KEYS` of `GlobalExceptionFilter` (RFC 6750 3.1).
const INVALID_TOKEN_KEYS: ReadonlySet<unknown> = new Set<ErrorKey>([
  ErrorKeys.AUTH.INVALID_TOKEN,
  ErrorKeys.AUTH.TOKEN_REVOKED,
  ErrorKeys.AUTH.TOKEN_INVALIDATED_ROTATION
]);

function isErrorKey(value: unknown): value is ErrorKey {
  return typeof value === 'string' && Object.hasOwn(ERROR_STATUS, value);
}

/** Mirrors `ApiError`: the status of the answer comes from `ERROR_STATUS`. */
export function sendError(
  res: Response,
  errorKey: ErrorKey,
  message: string,
  extra: Record<string, unknown> = {}
): void {
  // eslint-disable-next-line no-restricted-syntax -- the one place that pairs a key with its status
  res.status(ERROR_STATUS[errorKey]).json({ ...extra, message, errorKey });
}

/**
 * Mirrors `GlobalExceptionFilter`: each error answer carries the same closed
 * envelope, whatever body the route wrote. A body with an error key gets the
 * status of that key, so the mock cannot answer a key with another status
 * than the server.
 */
export const errorEnvelope: RequestHandler = (req, res, next) => {
  if (req.originalUrl.startsWith('/__control')) {
    next();
    return;
  }
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (
      res.statusCode < 400 ||
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      return json(body);
    }
    const source = body as Record<string, unknown>;
    if (isErrorKey(source['errorKey'])) {
      res.status(ERROR_STATUS[source['errorKey']]);
    }
    if (res.statusCode === 401) {
      res.setHeader(
        'WWW-Authenticate',
        INVALID_TOKEN_KEYS.has(source['errorKey'])
          ? 'Bearer error="invalid_token"'
          : 'Bearer'
      );
    }
    const envelope: Record<string, unknown> = {
      statusCode: res.statusCode,
      message: source['message'],
      error: httpStatusText(res.statusCode),
      timestamp: new Date().toISOString(),
      path: req.originalUrl
    };
    for (const field of FORWARDED_FIELDS) {
      if (source[field] !== undefined) envelope[field] = source[field];
    }
    return json(envelope);
  }) as Response['json'];
  next();
};

/** Mirrors the 404 that Nest answers for a route it does not know. */
export const routeNotFound: RequestHandler = (req, res) => {
  // eslint-disable-next-line no-restricted-syntax -- Nest sends this 404 with no key
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
};

/**
 * Mirrors Nest for an error that reaches the framework: bad JSON and a bad
 * URI encoding are a 400, an exposed http-errors 4xx (a body over the size
 * limit) keeps its status, and anything else is a 500 with no detail.
 */
export const unhandledError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof SyntaxError || err instanceof URIError) {
    // eslint-disable-next-line no-restricted-syntax -- Nest sends this 400 with no key
    res.status(400).json({ message: err.message });
    return;
  }
  const { status, expose, message } = (err ?? {}) as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    res.status(status).json({ message });
    return;
  }
  sendError(
    res,
    ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR,
    'Internal server error'
  );
};

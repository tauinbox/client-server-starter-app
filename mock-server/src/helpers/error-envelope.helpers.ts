import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ErrorKeys, httpStatusText } from '@app/shared/constants';

const FORWARDED_FIELDS = [
  'errors',
  'errorKey',
  'lockedUntil',
  'retryAfter'
] as const;

/**
 * Mirrors `GlobalExceptionFilter`: each error answer carries the same closed
 * envelope, whatever body the route wrote.
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
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
};

/**
 * Mirrors Nest for an error that reaches the framework: bad JSON and a bad
 * URI encoding are a 400, an exposed http-errors 4xx (a body over the size
 * limit) keeps its status, and anything else is a 500 with no detail.
 */
export const unhandledError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof SyntaxError || err instanceof URIError) {
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
  res.status(500).json({
    message: 'Internal server error',
    errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR
  });
};

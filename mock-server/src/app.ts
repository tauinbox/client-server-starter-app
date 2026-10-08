import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { redactSensitiveQuery } from '@app/shared/utils/redact-url';
import { registerRoutes } from './middleware';
import controlRouter from './control.routes';
import mockCheckoutRouter, { MOCK_CHECKOUT_PATH } from './routes/mock-checkout';
import {
  errorEnvelope,
  routeNotFound,
  unhandledError
} from './helpers/error-envelope.helpers';

export function createApp() {
  const app = express();
  app.use(errorEnvelope);
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  // JSON only, as the server: a cross-site form can post a urlencoded body with
  // no preflight, and a login sent that way plants the sender's session.
  app.use(express.json({ limit: '100kb' }));
  // Express 5 leaves `req.body` undefined when no JSON body was parsed. The
  // handlers validate an empty object into the same 400 as the server.
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });

  // Request ID middleware (mirrors server's RequestIdMiddleware)
  const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const candidate = typeof incoming === 'string' ? incoming : '';
    const requestId = REQUEST_ID_PATTERN.test(candidate)
      ? candidate
      : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Request logging middleware (mirrors server's RequestLoggingMiddleware)
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api/health/')) {
      next();
      return;
    }

    const start = Date.now();
    const logLevel = (process.env['REQUEST_LOG_LEVEL'] || 'all').toLowerCase();

    res.on('finish', () => {
      const statusCode = res.statusCode;

      if (logLevel === 'error' && statusCode < 500) return;
      if (logLevel === 'warn' && statusCode < 400) return;

      const duration = Date.now() - start;
      const reqId = res.getHeader('X-Request-Id');
      const level =
        statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'LOG';
      const reqIdSuffix = reqId ? ` [req-id: ${reqId}]` : '';
      console.log(
        `[HTTP] [${level}] ${req.method} ${redactSensitiveQuery(req.originalUrl)} ${statusCode} ${duration}ms${reqIdSuffix}`
      );
    });
    next();
  });

  // Control API (for E2E tests and debugging)
  app.use('/__control', controlRouter);

  app.use(MOCK_CHECKOUT_PATH, mockCheckoutRouter);

  // Application routes
  registerRoutes(app);
  app.use(routeNotFound);
  app.use(unhandledError);

  return app;
}

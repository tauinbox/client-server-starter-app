import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import { registerRoutes } from './middleware';
import controlRouter from './control.routes';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Request ID middleware (mirrors server's RequestIdMiddleware)
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Request logging middleware (mirrors server's RequestLoggingMiddleware)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const reqId = res.getHeader('X-Request-Id');
      const level =
        res.statusCode >= 500
          ? 'ERROR'
          : res.statusCode >= 400
            ? 'WARN'
            : 'LOG';
      const reqIdSuffix = reqId ? ` [req-id: ${reqId}]` : '';
      console.log(
        `[HTTP] [${level}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms${reqIdSuffix}`
      );
    });
    next();
  });

  // Control API (for E2E tests and debugging)
  app.use('/__control', controlRouter);

  // Application routes
  registerRoutes(app);

  return app;
}

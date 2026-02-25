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

  // Control API (for E2E tests and debugging)
  app.use('/__control', controlRouter);

  // Application routes
  registerRoutes(app);

  return app;
}

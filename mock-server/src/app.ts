import express from 'express';
import cors from 'cors';
import { registerRoutes } from './middleware';
import controlRouter from './control.routes';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Control API (for E2E tests and debugging)
  app.use('/__control', controlRouter);

  // Application routes
  registerRoutes(app);

  return app;
}

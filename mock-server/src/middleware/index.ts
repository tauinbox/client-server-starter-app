import type { Express } from 'express';
import authRouter from './auth.middleware';
import usersRouter from './users.middleware';
import oauthRouter from './oauth.middleware';

export function registerRoutes(app: Express): void {
  app.use('/api/v1/auth/oauth', oauthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
}

import { Router } from 'express';
import { authGuard } from '../helpers/auth.helpers';

// Public endpoint. Full evaluation logic lands in FF-003 alongside state +
// evaluator integration; for now the contract-stub returns an empty map so
// the `contracts/routes.json` contract test (which fires unauthenticated) sees
// a 200 and so the client can be wired against the mock without 404s.
const publicRouter = Router();

publicRouter.get('/', (_req, res) => {
  res.json({ flags: {}, evaluatedAt: new Date().toISOString() });
});

// Admin endpoints. Full CRUD + optimistic locking lands in FF-003. Until
// then the stub returns 401 (via authGuard) for unauthenticated callers and
// 501 Not Implemented for authenticated callers so accidental use surfaces
// loudly instead of silently passing.
const adminRouter = Router();

adminRouter.use(authGuard);
adminRouter.all('*', (_req, res) => {
  res.status(501).json({
    message:
      'Feature flags admin endpoints are not implemented in mock-server yet',
    statusCode: 501
  });
});

export {
  publicRouter as featureFlagsRouter,
  adminRouter as featureFlagsAdminRouter
};

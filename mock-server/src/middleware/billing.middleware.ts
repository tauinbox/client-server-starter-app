import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PlanResponse } from '@app/shared/types';
import { getState, toPlanResponse } from '../state';

const router = Router();

// Provider webhook receivers. Public — providers verify their own authenticity,
// so there is no JWT. The mock has no real signature to check, so it mirrors
// only the server's observable status contract: a missing/empty body is a 400
// (the server's "Missing webhook body" guard), any payload is accepted with the
// 200 success shape. Synthetic lifecycle injection is driven through /__control.
function handleWebhook(req: Request, res: Response): void {
  if (!req.body || Object.keys(req.body).length === 0) {
    res.status(400).json({ message: 'Missing webhook body', statusCode: 400 });
    return;
  }
  res.status(200).json({ received: true });
}

router.post('/paddle', handleWebhook);
router.post('/yookassa', handleWebhook);

// Public plan catalog. Mirrors the server's @Public() GET /billing/plans:
// active plans only, oldest first (seed order), each carrying the per-provider
// prices map. No auth.
const billingRouter = Router();

billingRouter.get('/plans', (_req: Request, res: Response) => {
  const plans: PlanResponse[] = [];
  for (const plan of getState().plans.values()) {
    if (plan.active) plans.push(toPlanResponse(plan));
  }
  plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json(plans);
});

export default router;
export { billingRouter };

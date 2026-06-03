import { Router } from 'express';

const router = Router();

// Provider webhook receivers. Public — providers verify their own authenticity,
// so there is no JWT. The mock has no real signature to check, so it accepts
// every delivery and returns the server's 200 success contract. Synthetic
// lifecycle injection is driven separately through the /__control surface.
router.post('/paddle', (_req, res) => {
  res.status(200).json({ received: true });
});

router.post('/yookassa', (_req, res) => {
  res.status(200).json({ received: true });
});

export default router;

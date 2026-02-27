import { Router } from 'express';

const router = Router();

router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/ready', (_req, res) => {
  res.json({
    status: 'ok',
    info: { database: { status: 'up' } },
    error: {},
    details: { database: { status: 'up' } }
  });
});

export default router;

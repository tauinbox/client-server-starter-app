import { Router } from 'express';

const router = Router();

router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/ready', (_req, res) => {
  const databases = {
    database: { status: 'up' },
    settingsDatabase: { status: 'up' }
  };

  res.json({ status: 'ok', info: databases, error: {}, details: databases });
});

export default router;

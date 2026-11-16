import { Router } from 'express';
import { regionConfig } from '../helpers/region.helpers';

const router = Router();

// GET /api/v1/config/region
router.get('/region', (_req, res) => {
  res.json(regionConfig());
});

export default router;

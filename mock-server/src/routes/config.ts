import { Router } from 'express';
import { MOCK_REGION_CONFIG } from '../helpers/region.helpers';

const router = Router();

// GET /api/v1/config/region
router.get('/region', (_req, res) => {
  res.json(MOCK_REGION_CONFIG);
});

export default router;

import { Router } from 'express';
import type { RegionConfigResponse } from '@app/shared/types';

const router = Router();

// The mock is one cell of the `intl` region with no peers, as production.
const REGION_CONFIG: RegionConfigResponse = { region: 'intl', peers: {} };

// GET /api/v1/config/region
router.get('/region', (_req, res) => {
  res.json(REGION_CONFIG);
});

export default router;

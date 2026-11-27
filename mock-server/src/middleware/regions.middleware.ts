import { Router } from 'express';
import {
  ErrorKeys,
  HOME_DATA_REGION,
  isDataRegion
} from '@app/shared/constants';
import type { RegionStatusResponse } from '@app/shared/types';
import {
  optionalAuthentication,
  permissionGuard
} from '../helpers/auth.helpers';
import { sendError } from '../helpers/error-envelope.helpers';
import { sendValidationError } from '../helpers/validation-error.helpers';
import { getState, logAudit } from '../state';
import { booleanErrors, unknownPropertyErrors } from '../utils/validation';

const router = Router();

// PUT /api/v1/admin/regions/:region - mirrors RegionRegistryService.setPublic
router.put('/:region', permissionGuard('update', 'Region'), (req, res) => {
  const body = (req.body ?? {}) as { public?: unknown };
  const errors = [
    ...unknownPropertyErrors(req.body, ['public']),
    ...booleanErrors('public', body.public)
  ];

  if (errors.length > 0) {
    sendValidationError(res, 'body', errors);

    return;
  }

  const isPublic = body.public as boolean;
  const { region } = req.params;

  if (!isDataRegion(region)) {
    sendError(res, ErrorKeys.REGIONS.NOT_FOUND, 'Region not found');

    return;
  }

  if (region === HOME_DATA_REGION) {
    sendError(
      res,
      ErrorKeys.REGIONS.CANNOT_CLOSE_HOME,
      'The home region always takes new accounts'
    );

    return;
  }

  const registry = getState().regionRegistry;

  // A repeat of the current status changes nothing and writes no audit row.
  if ((registry[region] ?? false) !== isPublic) {
    registry[region] = isPublic;
    const auth = optionalAuthentication(req);

    logAudit('REGION_STATUS_UPDATE', {
      actorId: auth?.user.id ?? null,
      actorEmail: auth?.user.email ?? null,
      targetId: region,
      targetType: 'Region',
      details: { public: isPublic }
    });
  }

  const response: RegionStatusResponse = { region, public: isPublic };

  res.json(response);
});

export default router;

import { Router } from 'express';
import { changedFields } from '@app/shared/utils/changed-fields';
import { ErrorKeys, RESOURCE_LIST_QUERY } from '@app/shared/constants';
import { listPage, listQueryErrors } from '../helpers/list-query.helpers';

import { getState, logAudit, toResourceResponse } from '../state';
import {
  assertInstancePermission,
  permissionGuard
} from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  stringArrayErrors,
  stringErrors,
  unknownPropertyErrors
} from '../utils/validation';

const router = Router();

// GET /api/v1/rbac/metadata
router.get('/metadata', permissionGuard('read', 'Permission'), (_req, res) => {
  const state = getState();
  const resources = Array.from(state.resources.values()).map(
    toResourceResponse
  );
  res.json({ resources });
});

// GET /api/v1/rbac/resources
// GET /api/v1/rbac/resources/cursor
router.get(
  '/resources/cursor',
  permissionGuard('read', 'Permission'),
  (req, res) => {
    const query = req.query as Record<string, unknown>;
    const errors = listQueryErrors(query, RESOURCE_LIST_QUERY);
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }
    const page = listPage(
      Array.from(getState().resources.values()),
      RESOURCE_LIST_QUERY,
      query
    );
    res.json({ data: page.data.map(toResourceResponse), meta: page.meta });
  }
);

router.get('/resources', permissionGuard('read', 'Permission'), (_req, res) => {
  const resources = Array.from(getState().resources.values()).map(
    toResourceResponse
  );
  res.json(resources);
});

// POST /api/v1/rbac/resources/:id/restore
router.post(
  '/resources/:id/restore',
  permissionGuard('update', 'Permission'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();
    const resource = state.resources.get(id);

    if (!resource) {
      res.status(404).json({
        message: 'Resource not found',
        statusCode: 404,
        errorKey: ErrorKeys.RESOURCES.NOT_FOUND
      });
      return;
    }

    // `ResourceService.restore` raises the isRegistered 400, so it sits below
    // the instance check on the server.
    if (
      !assertInstancePermission(
        req,
        res,
        'update',
        'Permission',
        resource,
        'Resource'
      )
    ) {
      return;
    }

    if (!resource.isRegistered) {
      res.status(400).json({
        message: `Cannot restore resource "${resource.name}": its @RegisterResource controller is not registered. Restore the controller code first.`,
        statusCode: 400,
        errorKey: ErrorKeys.RESOURCES.CANNOT_RESTORE
      });
      return;
    }

    resource.isOrphaned = false;

    const actor = (req as AuthenticatedRequest).user;
    logAudit('RESOURCE_RESTORE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'Resource',
      ip: req.ip
    });

    res.json(toResourceResponse(resource));
  }
);

// PATCH /api/v1/rbac/resources/:id
router.patch(
  '/resources/:id',
  permissionGuard('update', 'Permission'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();

    const { displayName, description, allowedActionNames } = req.body;

    // The server's global pipe runs before the handler, so a malformed body is a
    // 400 whether or not the resource exists, and it reports every violation at
    // once, in DTO declaration order.
    const errors = [
      ...unknownPropertyErrors(req.body, [
        'displayName',
        'description',
        'allowedActionNames'
      ]),
      ...stringErrors('displayName', displayName, {
        max: 100,
        optional: 'definedOnly'
      }),
      ...stringErrors('description', description, {
        max: 500,
        optional: 'nullable'
      }),
      ...stringArrayErrors('allowedActionNames', allowedActionNames, {
        maxItems: 100,
        maxItemLength: 50,
        optional: 'nullable'
      })
    ];

    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }

    const resource = state.resources.get(id);

    if (!resource) {
      res.status(404).json({
        message: 'Resource not found',
        statusCode: 404,
        errorKey: ErrorKeys.RESOURCES.NOT_FOUND
      });
      return;
    }

    if (
      !assertInstancePermission(
        req,
        res,
        'update',
        'Permission',
        resource,
        'Resource'
      )
    ) {
      return;
    }

    // Mirrors ResourceService.update: an admin may offer fewer actions than
    // the code checks, never one it does not check.
    const undeclared = ((allowedActionNames as string[] | null) ?? []).filter(
      (name) => !resource.actionNames.includes(name)
    );
    if (undeclared.length > 0) {
      res.status(400).json({
        message: `Resource "${resource.name}" does not check the actions: ${undeclared.join(', ')}`,
        statusCode: 400,
        errorKey: ErrorKeys.RESOURCES.ACTION_NOT_DECLARED
      });
      return;
    }

    const changed = changedFields(resource, {
      displayName,
      description,
      allowedActionNames
    });

    if (displayName !== undefined) {
      resource.displayName = displayName;
    }

    if (description !== undefined) {
      resource.description = description;
    }

    if (allowedActionNames !== undefined) {
      resource.allowedActionNames = allowedActionNames;
    }

    const actor = (req as AuthenticatedRequest).user;
    logAudit('RESOURCE_UPDATE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'Resource',
      details: { changedFields: changed },
      ip: req.ip
    });

    res.json(toResourceResponse(resource));
  }
);

export default router;

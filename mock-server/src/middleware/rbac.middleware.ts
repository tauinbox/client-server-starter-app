import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  ALLOWED_ACTION_SORT_COLUMNS,
  ALLOWED_RESOURCE_SORT_COLUMNS,
  ErrorKeys
} from '@app/shared/constants';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery
} from '../helpers/pagination.helpers';

import {
  getState,
  logAudit,
  toResourceResponse,
  toActionResponse
} from '../state';
import { adminGuard } from '../helpers/auth.helpers';
import { CASL_RESERVED_ACTION_NAMES } from '../constants';
import type { AuthenticatedRequest } from '../types';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  stringArrayErrors,
  stringErrors,
  trimmedStringErrors,
  unknownPropertyErrors
} from '../utils/validation';

const router = Router();

// GET /api/v1/rbac/metadata
router.get('/metadata', adminGuard, (_req, res) => {
  const state = getState();
  const resources = Array.from(state.resources.values()).map(
    toResourceResponse
  );
  const actions = Array.from(state.actions.values()).map(toActionResponse);
  res.json({ resources, actions });
});

// GET /api/v1/rbac/resources
// GET /api/v1/rbac/resources/cursor
router.get('/resources/cursor', adminGuard, (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = cursorQueryErrors(query, {
    sortColumns: ALLOWED_RESOURCE_SORT_COLUMNS
  });
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  const page = cursorPaginate(
    Array.from(getState().resources.values()),
    parseCursorQuery(query)
  );
  res.json({ data: page.data.map(toResourceResponse), meta: page.meta });
});

router.get('/resources', adminGuard, (_req, res) => {
  const resources = Array.from(getState().resources.values()).map(
    toResourceResponse
  );
  res.json(resources);
});

// POST /api/v1/rbac/resources/:id/restore
router.post(
  '/resources/:id/restore',
  adminGuard,
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
router.patch('/resources/:id', adminGuard, requireUuid('id'), (req, res) => {
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
    details: { changedFields: Object.keys(req.body) },
    ip: req.ip
  });

  res.json(toResourceResponse(resource));
});

// GET /api/v1/rbac/actions
// GET /api/v1/rbac/actions/cursor
router.get('/actions/cursor', adminGuard, (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = cursorQueryErrors(query, {
    sortColumns: ALLOWED_ACTION_SORT_COLUMNS
  });
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  const page = cursorPaginate(
    Array.from(getState().actions.values()),
    parseCursorQuery(query)
  );
  res.json({ data: page.data.map(toActionResponse), meta: page.meta });
});

router.get('/actions', adminGuard, (_req, res) => {
  const actions = Array.from(getState().actions.values()).map(toActionResponse);
  res.json(actions);
});

// POST /api/v1/rbac/actions
router.post('/actions', adminGuard, (req, res) => {
  const { name, displayName, description } = req.body;

  // `name` carries a `@Transform` that trims and lowercases before the
  // validators see it, so a whitespace-only name is an IsNotEmpty violation.
  const errors = [
    ...unknownPropertyErrors(req.body, ['name', 'displayName', 'description']),
    ...trimmedStringErrors('name', name, { max: 50, notEmpty: true }),
    ...stringErrors('displayName', displayName, { max: 100, notEmpty: true }),
    ...stringErrors('description', description, {
      max: 500,
      optional: 'nullable'
    })
  ];

  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }

  const trimmedName = (name as string).trim().toLowerCase();

  // Raised by the service, below the pipe, so it carries no `errors` array.
  if (CASL_RESERVED_ACTION_NAMES.includes(trimmedName)) {
    res.status(400).json({
      message: `Action name "${trimmedName}" is reserved and cannot be used`,
      statusCode: 400,
      errorKey: ErrorKeys.ACTIONS.NAME_RESERVED
    });
    return;
  }

  const desc = typeof description === 'string' ? description : '';

  // Check duplicate name
  const state = getState();
  for (const existing of state.actions.values()) {
    if (existing.name === trimmedName) {
      res.status(400).json({
        message: 'Action with this name already exists',
        statusCode: 400,
        errorKey: ErrorKeys.ACTIONS.NAME_EXISTS
      });
      return;
    }
  }

  const now = new Date().toISOString();
  const action = {
    id: uuidv4(),
    name: trimmedName,
    displayName,
    description: desc,
    isDefault: false,
    createdAt: now
  };

  state.actions.set(action.id, action);

  // Auto-create permissions for all resources
  for (const resource of state.resources.values()) {
    const perm = {
      id: uuidv4(),
      resourceId: resource.id,
      actionId: action.id,
      description: `${action.displayName} ${resource.displayName}`,
      createdAt: now
    };
    state.permissions.set(perm.id, perm);
  }

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ACTION_CREATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: action.id,
    targetType: 'Action',
    details: { name: trimmedName },
    ip: req.ip
  });

  res.status(201).json(toActionResponse(action));
});

// PATCH /api/v1/rbac/actions/:id
router.patch('/actions/:id', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();

  const { displayName, description } = req.body;

  // `actions.description` is NOT NULL, so UpdateActionDto rejects an explicit
  // null - unlike `resources.description`, which is nullable.
  const errors = [
    ...unknownPropertyErrors(req.body, ['displayName', 'description']),
    ...stringErrors('displayName', displayName, {
      max: 100,
      optional: 'definedOnly'
    }),
    ...stringErrors('description', description, {
      max: 500,
      optional: 'definedOnly'
    })
  ];

  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }

  const action = state.actions.get(id);

  if (!action) {
    res.status(404).json({
      message: 'Action not found',
      statusCode: 404,
      errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
    });
    return;
  }

  if (displayName !== undefined) {
    action.displayName = displayName;
  }

  if (description !== undefined) {
    action.description = description;
  }

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ACTION_UPDATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Action',
    details: { changedFields: Object.keys(req.body) },
    ip: req.ip
  });

  res.json(toActionResponse(action));
});

// DELETE /api/v1/rbac/actions/:id
router.delete('/actions/:id', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const action = state.actions.get(id);

  if (!action) {
    res.status(404).json({
      message: 'Action not found',
      statusCode: 404,
      errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
    });
    return;
  }

  if (action.isDefault) {
    res.status(403).json({
      message: 'Cannot delete default actions',
      statusCode: 403,
      errorKey: ErrorKeys.ACTIONS.CANNOT_DELETE_DEFAULT
    });
    return;
  }

  // Find all permissions that reference this action
  const affectedPermissionIds: string[] = [];
  for (const [permId, perm] of state.permissions) {
    if (perm.actionId === id) {
      affectedPermissionIds.push(permId);
    }
  }

  // Check if any role_permissions reference these permissions
  const usedInRolePerms = state.rolePermissions.some((rp) =>
    affectedPermissionIds.includes(rp.permissionId)
  );

  if (usedInRolePerms) {
    res.status(409).json({
      message:
        'Cannot delete action: it is referenced by role permissions. Remove the role-permission assignments first.',
      statusCode: 409,
      errorKey: ErrorKeys.ACTIONS.ASSIGNED_TO_ROLES
    });
    return;
  }

  // Delete associated permissions
  for (const permId of affectedPermissionIds) {
    state.permissions.delete(permId);
  }

  // Delete the action
  state.actions.delete(id);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ACTION_DELETE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Action',
    details: { name: action.name },
    ip: req.ip
  });

  res.send();
});

export default router;

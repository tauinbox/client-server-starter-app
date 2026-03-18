import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getState,
  logAudit,
  toResourceResponse,
  toActionResponse
} from '../state';
import { adminGuard, authGuard } from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const CASL_RESERVED_ACTION_NAMES = ['manage', 'all'];

// GET /api/v1/rbac/metadata
router.get('/metadata', authGuard, (_req, res) => {
  const state = getState();
  const resources = Array.from(state.resources.values()).map(
    toResourceResponse
  );
  const actions = Array.from(state.actions.values()).map(toActionResponse);
  res.json({ resources, actions });
});

// GET /api/v1/rbac/resources
router.get('/resources', adminGuard, (_req, res) => {
  const resources = Array.from(getState().resources.values()).map(
    toResourceResponse
  );
  res.json(resources);
});

// PATCH /api/v1/rbac/resources/:id
router.patch('/resources/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const resource = state.resources.get(id);

  if (!resource) {
    res.status(404).json({ message: 'Resource not found', statusCode: 404 });
    return;
  }

  const { displayName, description, allowedActionNames } = req.body;

  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      res.status(400).json({
        message: 'displayName must be a non-empty string',
        statusCode: 400
      });
      return;
    }
    if (displayName.length > 100) {
      res.status(400).json({
        message: 'displayName must not exceed 100 characters',
        statusCode: 400
      });
      return;
    }
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
router.get('/actions', adminGuard, (_req, res) => {
  const actions = Array.from(getState().actions.values()).map(toActionResponse);
  res.json(actions);
});

// POST /api/v1/rbac/actions
router.post('/actions', adminGuard, (req, res) => {
  const { name, displayName, description } = req.body;

  // Validate name
  if (!name || typeof name !== 'string') {
    res.status(400).json({ message: 'name is required', statusCode: 400 });
    return;
  }

  const trimmedName = name.trim().toLowerCase();

  if (trimmedName.length === 0) {
    res.status(400).json({ message: 'name is required', statusCode: 400 });
    return;
  }

  if (trimmedName.length > 50) {
    res.status(400).json({
      message: 'name must not exceed 50 characters',
      statusCode: 400
    });
    return;
  }

  if (!ACTION_NAME_PATTERN.test(trimmedName)) {
    res.status(400).json({
      message: 'name must match pattern /^[a-z][a-z0-9_]*$/',
      statusCode: 400
    });
    return;
  }

  if (CASL_RESERVED_ACTION_NAMES.includes(trimmedName)) {
    res.status(400).json({
      message: `Action name "${trimmedName}" is reserved and cannot be used`,
      statusCode: 400
    });
    return;
  }

  // Validate displayName
  if (!displayName || typeof displayName !== 'string') {
    res
      .status(400)
      .json({ message: 'displayName is required', statusCode: 400 });
    return;
  }

  if (displayName.length > 100) {
    res.status(400).json({
      message: 'displayName must not exceed 100 characters',
      statusCode: 400
    });
    return;
  }

  // Validate description
  const desc =
    description !== undefined && typeof description === 'string'
      ? description
      : '';

  if (desc.length > 500) {
    res.status(400).json({
      message: 'description must not exceed 500 characters',
      statusCode: 400
    });
    return;
  }

  // Check duplicate name
  const state = getState();
  for (const existing of state.actions.values()) {
    if (existing.name === trimmedName) {
      res.status(400).json({
        message: 'Action with this name already exists',
        statusCode: 400
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
router.patch('/actions/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const action = state.actions.get(id);

  if (!action) {
    res.status(404).json({ message: 'Action not found', statusCode: 404 });
    return;
  }

  const { displayName, description } = req.body;

  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      res.status(400).json({
        message: 'displayName must be a non-empty string',
        statusCode: 400
      });
      return;
    }
    if (displayName.length > 100) {
      res.status(400).json({
        message: 'displayName must not exceed 100 characters',
        statusCode: 400
      });
      return;
    }
    action.displayName = displayName;
  }

  if (description !== undefined) {
    if (typeof description === 'string' && description.length > 500) {
      res.status(400).json({
        message: 'description must not exceed 500 characters',
        statusCode: 400
      });
      return;
    }
    action.description = typeof description === 'string' ? description : '';
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
router.delete('/actions/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const action = state.actions.get(id);

  if (!action) {
    res.status(404).json({ message: 'Action not found', statusCode: 404 });
    return;
  }

  if (action.isDefault) {
    res.status(403).json({
      message: 'Cannot delete default actions',
      statusCode: 403
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
      statusCode: 409
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
    ip: req.ip
  });

  res.send();
});

export default router;

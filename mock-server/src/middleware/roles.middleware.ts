import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { ALLOWED_ROLE_SORT_COLUMNS } from '@app/shared/constants';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery
} from '../helpers/pagination.helpers';

import { validateMongoQueryKeys } from '@app/shared/utils/mongo-query-safety';
import {
  findConditionActionError,
  findFieldMatchShapeError,
  findIdentityBoundBranch,
  findOwnershipShapeError,
  findUserAttrShapeError
} from '@app/shared/utils/permission-condition-shape';
import {
  findUserById,
  getState,
  logAudit,
  toPermissionResponse
} from '../state';
import { adminGuard } from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';
import { pushToUser } from '../sse-hub';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import { validateMaxLength } from '../utils/validation';

const router = Router();

type RoleName = { ok: true; name: string } | { ok: false; error: string };

// CreateRoleDto pairs @Transform(trim) with @IsNotEmpty/@IsString/@MaxLength(100),
// and UpdateRoleDto inherits them without the null escape hatch.
function normalizeRoleName(value: unknown): RoleName {
  if (typeof value !== 'string') {
    return { ok: false, error: 'name must be a string' };
  }
  const name = value.trim();
  if (name.length === 0) {
    return { ok: false, error: 'name should not be empty' };
  }
  const maxErr = validateMaxLength(name, 100, 'name');
  return maxErr ? { ok: false, error: maxErr } : { ok: true, name };
}

function validateCustomCondition(custom: string | undefined): string | null {
  if (!custom) return null;
  try {
    const parsed = JSON.parse(custom);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return 'custom must be a JSON object';
    return validateMongoQueryKeys(parsed);
  } catch {
    return 'custom must be valid JSON';
  }
}

const CONDITION_KEYS = new Set([
  'effect',
  'ownership',
  'fieldMatch',
  'userAttr',
  'custom'
]);

// Mirrors the server's PermissionConditionDto validation (ValidationPipe
// whitelist + per-branch shape checks) so a payload the real server rejects
// with 400 cannot pass the mock and turn an e2e run false-green.
function findConditionShapeError(conditions: unknown): string | null {
  if (conditions === undefined || conditions === null) return null;
  if (typeof conditions !== 'object' || Array.isArray(conditions)) {
    return 'conditions must be an object';
  }

  const cond = conditions as Record<string, unknown>;
  for (const key of Object.keys(cond)) {
    if (!CONDITION_KEYS.has(key)) {
      return `property conditions.${key} should not exist`;
    }
  }

  if (
    cond['effect'] != null &&
    cond['effect'] !== 'allow' &&
    cond['effect'] !== 'deny'
  ) {
    return 'effect must be one of the following values: allow, deny';
  }

  if (cond['ownership'] != null) {
    const error = findOwnershipShapeError(cond['ownership']);
    if (error) return error;
  }

  if (cond['fieldMatch'] != null) {
    const error = findFieldMatchShapeError(cond['fieldMatch']);
    if (error) return error;
  }

  if (cond['userAttr'] != null) {
    const error = findUserAttrShapeError(cond['userAttr']);
    if (error) return error;
  }

  if (cond['custom'] != null) {
    if (typeof cond['custom'] !== 'string') {
      return 'custom must be a JSON string';
    }
    const error = validateCustomCondition(cond['custom']);
    if (error) {
      return `conditions.custom contains disallowed operator or is invalid: ${error}`;
    }
  }

  return null;
}

// Mirrors RoleService.assertConditionsApplicable: an identity-bound branch on
// a `create` grant can never match a record that does not exist yet, so it is
// rejected on write instead of being stored as a dead restriction. Unknown
// permission ids fall through to the unknown-id 400, as on the server.
function findGrantConditionError(
  permissionId: string,
  conditions: unknown
): string | null {
  if (findIdentityBoundBranch(conditions) === null) return null;
  const state = getState();
  const permission = state.permissions.get(permissionId);
  if (!permission) return null;
  const resource = state.resources.get(permission.resourceId);
  const action = state.actions.get(permission.actionId);
  if (!resource || !action) return null;
  const error = findConditionActionError(action.name, conditions);
  return error === null
    ? null
    : `Cannot grant ${action.name}:${resource.subject} - ${error}`;
}

// Notify every connected holder of a role that its effective permission set
// changed, so their client refreshes abilities without a reload. Mirrors the
// server's RolePermissionsChangedEvent fan-out (no token revocation).
export function notifyRoleHolders(roleName: string): void {
  for (const user of getState().users.values()) {
    if (user.roles.includes(roleName)) {
      pushToUser(user.id, { type: 'permissions_updated', userId: user.id });
    }
  }
}

function isActorSuper(req: unknown): boolean {
  const actor = (req as AuthenticatedRequest).user;
  if (!actor) return false;
  const state = getState();
  return Array.from(state.roles.values()).some(
    (r) => r.isSuper && actor.roles.includes(r.name)
  );
}

// GET /api/v1/roles
// GET /api/v1/roles/cursor
router.get('/cursor', adminGuard, (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = cursorQueryErrors(query, {
    sortColumns: ALLOWED_ROLE_SORT_COLUMNS
  });
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  res.json(
    cursorPaginate(
      Array.from(getState().roles.values()),
      parseCursorQuery(query)
    )
  );
});

router.get('/', adminGuard, (_req, res) => {
  const roles = Array.from(getState().roles.values());

  res.json(roles.sort((a, b) => a.name.localeCompare(b.name)));
});

// GET /api/v1/roles/permissions
router.get('/permissions', adminGuard, (_req, res) => {
  const state = getState();
  const permissions = Array.from(state.permissions.values())
    .map((p) => toPermissionResponse(p))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  permissions.sort((a, b) => {
    const cmp = a.resource.name.localeCompare(b.resource.name);
    return cmp !== 0 ? cmp : a.action.name.localeCompare(b.action.name);
  });
  res.json(permissions);
});

// GET /api/v1/roles/:id/permissions
router.get('/:id/permissions', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  const rolePerms = state.rolePermissions
    .filter((rp) => rp.roleId === id)
    .map((rp) => {
      const permission = state.permissions.get(rp.permissionId);
      if (!permission) return null;
      const permResponse = toPermissionResponse(permission);
      if (!permResponse) return null;
      return {
        id: rp.id,
        roleId: rp.roleId,
        permissionId: rp.permissionId,
        permission: permResponse,
        conditions: rp.conditions
      };
    })
    .filter((rp): rp is NonNullable<typeof rp> => rp !== null);

  res.json(rolePerms);
});

// GET /api/v1/roles/:id
router.get('/:id', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const role = getState().roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  res.json(role);
});

// POST /api/v1/roles
router.post('/', adminGuard, (req, res) => {
  const { description, isSuper } = req.body;

  const normalized = normalizeRoleName(req.body.name);
  if (!normalized.ok) {
    res.status(400).json(validationError(normalized.error));
    return;
  }
  const name = normalized.name;

  if (isSuper !== undefined) {
    res.status(400).json({
      message: 'isSuper flag cannot be set via API',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN
    });
    return;
  }

  const state = getState();
  for (const existing of state.roles.values()) {
    if (existing.name === name) {
      res.status(400).json({
        message: 'Role with this name already exists',
        statusCode: 400,
        errorKey: ErrorKeys.ROLES.NAME_EXISTS
      });
      return;
    }
  }

  const now = new Date().toISOString();
  const role = {
    id: uuidv4(),
    name,
    description: description ?? null,
    isSystem: false,
    isSuper: false,
    createdAt: now,
    updatedAt: now
  };

  state.roles.set(role.id, role);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_CREATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: role.id,
    targetType: 'Role',
    details: { name },
    ip: req.ip
  });

  res.status(201).json(role);
});

// PATCH /api/v1/roles/:id
router.patch('/:id', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();

  // The server's global ValidationPipe runs before the handler, so a body that
  // fails UpdateRoleDto is a 400 whether or not the role exists. isSuper is not
  // a DTO property either, so forbidNonWhitelisted rejects it just as early.
  const { name, description, isSuper } = req.body;

  if (isSuper !== undefined) {
    res.status(400).json({
      message: 'isSuper flag cannot be changed via API',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN
    });
    return;
  }

  const normalized = name === undefined ? undefined : normalizeRoleName(name);
  if (normalized && !normalized.ok) {
    res.status(400).json(validationError(normalized.error));
    return;
  }

  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  if (role.isSystem) {
    res.status(400).json({
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  if (normalized?.ok) {
    if (normalized.name !== role.name) {
      for (const existing of state.roles.values()) {
        if (existing.name === normalized.name) {
          res.status(400).json({
            message: 'Role with this name already exists',
            statusCode: 400,
            errorKey: ErrorKeys.ROLES.NAME_EXISTS
          });
          return;
        }
      }
      role.name = normalized.name;
    }
  }

  if (description !== undefined) {
    role.description = description;
  }

  role.updatedAt = new Date().toISOString();

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_UPDATE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    details: { changedFields: Object.keys(req.body) },
    ip: req.ip
  });

  res.json(role);
});

// DELETE /api/v1/roles/:id
router.delete('/:id', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  if (role.isSystem) {
    res.status(400).json({
      message: 'Cannot delete system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_DELETE_SYSTEM
    });
    return;
  }

  // Capture holders before unassigning — the loop below clears user.roles.
  const holderIds = Array.from(state.users.values())
    .filter((u) => u.roles.includes(role.name))
    .map((u) => u.id);

  // Remove role-permission associations
  state.rolePermissions = state.rolePermissions.filter(
    (rp) => rp.roleId !== id
  );

  // Remove role from users
  for (const user of state.users.values()) {
    user.roles = user.roles.filter((r) => r !== role.name);
  }

  state.roles.delete(id);

  for (const userId of holderIds) {
    pushToUser(userId, { type: 'permissions_updated', userId });
  }

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_DELETE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    ip: req.ip
  });

  res.send();
});

// PUT /api/v1/roles/:id/permissions  — replaces the full permission set atomically
router.put('/:id/permissions', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();

  // SetPermissionsDto is validated by the server's global pipe before the
  // handler runs, so its shape checks precede the role lookup. Everything that
  // needs the role or the permission registry stays below the 404.
  const { items } = req.body as {
    items?: { permissionId: string; conditions?: unknown }[];
  };
  if (!Array.isArray(items)) {
    res.status(400).json(validationError('items must be an array'));
    return;
  }

  if (items.length > 500) {
    res
      .status(400)
      .json(validationError('items must contain no more than 500 elements'));
    return;
  }

  // Validate condition shapes (mirrors the server's DTO validation)
  for (const item of items) {
    const error = findConditionShapeError(item.conditions);
    if (error) {
      res.status(400).json(validationError(error));
      return;
    }
  }

  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  if (role.isSystem && !isActorSuper(req)) {
    res.status(400).json({
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  for (const item of items) {
    const error = findGrantConditionError(item.permissionId, item.conditions);
    if (error) {
      res.status(400).json({
        message: error,
        statusCode: 400,
        errorKey: ErrorKeys.ROLES.CONDITION_NOT_APPLICABLE
      });
      return;
    }
  }

  // Mirror the server: unknown ids fail validation with 400 before the
  // existing set is touched.
  const unknownItem = items.find(
    (item) => !state.permissions.has(item.permissionId)
  );
  if (unknownItem) {
    res.status(400).json({
      message: `Permission ${unknownItem.permissionId} not found`,
      statusCode: 400,
      errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
    });
    return;
  }

  // Replace all existing assignments for this role
  state.rolePermissions = state.rolePermissions.filter(
    (rp) => rp.roleId !== id
  );

  for (const item of items) {
    state.rolePermissions.push({
      id: uuidv4(),
      roleId: id,
      permissionId: item.permissionId,
      conditions: (item.conditions as null) ?? null
    });
  }

  notifyRoleHolders(role.name);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('PERMISSION_ASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    details: { permissionIds: items.map((i) => i.permissionId) },
    ip: req.ip
  });

  res.send();
});

// POST /api/v1/roles/:id/permissions
router.post('/:id/permissions', adminGuard, requireUuid('id'), (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();

  // AssignPermissionsDto is validated by the server's global pipe before the
  // handler runs, so its shape checks precede the role lookup. Everything that
  // needs the role or the permission registry stays below the 404.
  const { permissionIds, conditions } = req.body;
  if (!Array.isArray(permissionIds)) {
    res.status(400).json(validationError('permissionIds must be an array'));
    return;
  }

  if (permissionIds.length === 0) {
    res.status(400).json(validationError('permissionIds should not be empty'));
    return;
  }

  if (permissionIds.length > 500) {
    res
      .status(400)
      .json(
        validationError('permissionIds must contain no more than 500 elements')
      );
    return;
  }

  // Validate condition shape (mirrors the server's DTO validation)
  const conditionError = findConditionShapeError(conditions);
  if (conditionError) {
    res.status(400).json(validationError(conditionError));
    return;
  }

  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({
      message: 'Role not found',
      statusCode: 404,
      errorKey: ErrorKeys.ROLES.NOT_FOUND
    });
    return;
  }

  if (role.isSystem && !isActorSuper(req)) {
    res.status(400).json({
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  for (const permissionId of permissionIds as string[]) {
    const error = findGrantConditionError(permissionId, conditions);
    if (error) {
      res.status(400).json({
        message: error,
        statusCode: 400,
        errorKey: ErrorKeys.ROLES.CONDITION_NOT_APPLICABLE
      });
      return;
    }
  }

  // Mirror the server: unknown ids fail validation with 400 before anything
  // is written, then a duplicate pair maps to 409 (unique constraint) with
  // no partial writes (single-transaction save on the server).
  const unknownId = (permissionIds as string[]).find(
    (permissionId) => !state.permissions.has(permissionId)
  );
  if (unknownId !== undefined) {
    res.status(400).json({
      message: `Permission ${unknownId} not found`,
      statusCode: 400,
      errorKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
    });
    return;
  }

  const duplicateId = (permissionIds as string[]).find((permissionId) =>
    state.rolePermissions.some(
      (rp) => rp.roleId === id && rp.permissionId === permissionId
    )
  );
  if (duplicateId !== undefined) {
    res.status(409).json({
      message: 'A record with this value already exists',
      statusCode: 409,
      errorKey: ErrorKeys.DB.UNIQUE_VIOLATION
    });
    return;
  }

  for (const permissionId of permissionIds as string[]) {
    state.rolePermissions.push({
      id: uuidv4(),
      roleId: id,
      permissionId,
      conditions: conditions ?? null
    });
  }

  notifyRoleHolders(role.name);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('PERMISSION_ASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    details: { permissionIds },
    ip: req.ip
  });

  res.send();
});

// DELETE /api/v1/roles/:id/permissions/:permissionId
router.delete(
  '/:id/permissions/:permissionId',
  adminGuard,
  requireUuid('id', 'permissionId'),
  (req, res) => {
    const id = req.params['id'] as string;
    const permissionId = req.params['permissionId'] as string;
    const state = getState();
    const role = state.roles.get(id);

    if (!role) {
      res.status(404).json({
        message: 'Role not found',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.NOT_FOUND
      });
      return;
    }

    if (role.isSystem && !isActorSuper(req)) {
      res.status(400).json({
        message: 'Cannot modify system roles',
        statusCode: 400,
        errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
      });
      return;
    }

    state.rolePermissions = state.rolePermissions.filter(
      (rp) => !(rp.roleId === id && rp.permissionId === permissionId)
    );

    notifyRoleHolders(role.name);

    const actor = (req as AuthenticatedRequest).user;
    logAudit('PERMISSION_UNASSIGN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'Role',
      details: { permissionId },
      ip: req.ip
    });

    res.send();
  }
);

// POST /api/v1/roles/assign/:userId
router.post(
  '/assign/:userId',
  adminGuard,
  requireUuid('userId'),
  (req, res) => {
    const userId = req.params['userId'] as string;
    const { roleId } = req.body;

    const state = getState();
    const user = findUserById(userId);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    const role = state.roles.get(roleId);
    if (!role) {
      res.status(404).json({
        message: 'Role not found',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.NOT_FOUND
      });
      return;
    }

    // Prevent assigning super roles via API (only super users bypass, and they
    // already pass adminGuard — but a future non-super admin role would need this)
    if (role.isSuper) {
      const actor = (req as AuthenticatedRequest).user;
      const actorRoles = Array.from(state.roles.values()).filter((r) =>
        actor.roles.includes(r.name)
      );
      if (!actorRoles.some((r) => r.isSuper)) {
        res.status(403).json({
          message: 'Cannot assign super roles',
          statusCode: 403
        });
        return;
      }
    }

    // Mirror the server: a duplicate assignment hits the user_roles unique
    // constraint and maps to 409 before any side effect (no token revocation,
    // no audit entry, no SSE push).
    if (user.roles.includes(role.name)) {
      res.status(409).json({
        message: 'A record with this value already exists',
        statusCode: 409,
        errorKey: ErrorKeys.DB.UNIQUE_VIOLATION
      });
      return;
    }

    user.roles.push(role.name);

    // Revoke tokens on any role change (mirrors UserRoleChangedListener)
    user.tokenRevokedAt = new Date().toISOString();

    const actor = (req as AuthenticatedRequest).user;
    logAudit('ROLE_ASSIGN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId },
      ip: req.ip
    });

    pushToUser(userId, { type: 'permissions_updated', userId });
    res.send();
  }
);

// DELETE /api/v1/roles/assign/:userId/:roleId
router.delete(
  '/assign/:userId/:roleId',
  adminGuard,
  requireUuid('userId', 'roleId'),
  (req, res) => {
    const userId = req.params['userId'] as string;
    const roleId = req.params['roleId'] as string;

    const state = getState();
    const user = findUserById(userId);
    if (!user) {
      res.status(404).json({
        message: 'User not found',
        statusCode: 404,
        errorKey: ErrorKeys.USERS.NOT_FOUND
      });
      return;
    }

    const role = state.roles.get(roleId);
    if (!role) {
      res.status(404).json({
        message: 'Role not found',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.NOT_FOUND
      });
      return;
    }

    // Prevent removing super roles via API unless actor is also super
    if (role.isSuper) {
      const actor = (req as AuthenticatedRequest).user;
      const actorRoles = Array.from(state.roles.values()).filter((r) =>
        actor.roles.includes(r.name)
      );
      if (!actorRoles.some((r) => r.isSuper)) {
        res.status(403).json({
          message: 'Cannot remove super roles',
          statusCode: 403
        });
        return;
      }
    }

    user.roles = user.roles.filter((r) => r !== role.name);

    // Revoke tokens on any role change (mirrors UserRoleChangedListener)
    user.tokenRevokedAt = new Date().toISOString();

    const actor = (req as AuthenticatedRequest).user;
    logAudit('ROLE_UNASSIGN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId },
      ip: req.ip
    });

    pushToUser(userId, { type: 'permissions_updated', userId });
    res.send();
  }
);

export default router;

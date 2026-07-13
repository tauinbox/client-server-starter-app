import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { validateMongoQueryKeys } from '@app/shared/utils/mongo-query-safety';
import {
  findFieldMatchShapeError,
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

const router = Router();

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
router.get('/:id/permissions', adminGuard, (req, res) => {
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
router.get('/:id', adminGuard, (req, res) => {
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
  const { name, description, isSuper } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ message: 'Role name is required', statusCode: 400 });
    return;
  }

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
router.patch('/:id', adminGuard, (req, res) => {
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
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  const { name, description, isSuper } = req.body;

  if (isSuper !== undefined) {
    res.status(400).json({
      message: 'isSuper flag cannot be changed via API',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN
    });
    return;
  }

  if (name !== undefined && name !== role.name) {
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
    role.name = name;
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
router.delete('/:id', adminGuard, (req, res) => {
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
router.put('/:id/permissions', adminGuard, (req, res) => {
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

  if (role.isSystem && !isActorSuper(req)) {
    res.status(400).json({
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  const { items } = req.body as {
    items?: { permissionId: string; conditions?: unknown }[];
  };
  if (!Array.isArray(items)) {
    res
      .status(400)
      .json({ message: 'items must be an array', statusCode: 400 });
    return;
  }

  // Validate condition shapes (mirrors the server's DTO validation)
  for (const item of items) {
    const error = findConditionShapeError(item.conditions);
    if (error) {
      res.status(400).json({
        message: [error],
        statusCode: 400,
        error: 'Bad Request'
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
router.post('/:id/permissions', adminGuard, (req, res) => {
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

  if (role.isSystem && !isActorSuper(req)) {
    res.status(400).json({
      message: 'Cannot modify system roles',
      statusCode: 400,
      errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
    });
    return;
  }

  const { permissionIds, conditions } = req.body;
  if (!Array.isArray(permissionIds)) {
    res
      .status(400)
      .json({ message: 'permissionIds must be an array', statusCode: 400 });
    return;
  }

  // Validate condition shape (mirrors the server's DTO validation)
  const conditionError = findConditionShapeError(conditions);
  if (conditionError) {
    res.status(400).json({
      message: [conditionError],
      statusCode: 400,
      error: 'Bad Request'
    });
    return;
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
router.delete('/:id/permissions/:permissionId', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const permissionId = req.params['permissionId'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (role?.isSystem && !isActorSuper(req)) {
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

  if (role) notifyRoleHolders(role.name);

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
});

// POST /api/v1/roles/assign/:userId
router.post('/assign/:userId', adminGuard, (req, res) => {
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
});

// DELETE /api/v1/roles/assign/:userId/:roleId
router.delete('/assign/:userId/:roleId', adminGuard, (req, res) => {
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
});

export default router;

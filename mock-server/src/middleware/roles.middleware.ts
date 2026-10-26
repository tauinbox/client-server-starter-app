import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import {
  ErrorKeys,
  ROLE_LIST_QUERY,
  ROLE_NAME_MAX_LENGTH
} from '@app/shared/constants';
import {
  listPage,
  listQueryErrors,
  rejectInvalidCursor
} from '../helpers/list-query.helpers';

import type { PermissionCondition } from '@app/shared/types';
import { findCustomQueryError } from '@app/shared/utils/mongo-query-safety';
import { changedFields, withChanges } from '@app/shared/utils/changed-fields';
import { grantableActionNames } from '@app/shared/utils/grantable-actions';
import {
  findConditionActionError,
  findConditionFieldError,
  findConditionSupportError,
  findFieldMatchShapeError,
  findOwnershipShapeError,
  findUserAttrShapeError
} from '@app/shared/utils/permission-condition-shape';
import {
  findUserById,
  getState,
  logAudit,
  revokeUserSessions,
  toPermissionResponse
} from '../state';
import {
  assertCanWriteUser,
  assertInstancePermission,
  isActorSuper,
  logRefusal,
  permissionGuard
} from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';
import { sameConditions } from '@app/shared/utils/grant-scope';
import { assertGrantScope, denyRowsOf } from '../helpers/grant-scope.helpers';
import { pushToUser } from '../sse-hub';
import {
  pushUserCrudEvent,
  pushUserListStale
} from '../helpers/user-list-events.helpers';
import { rewriteRoleNameInRules } from './feature-flags.middleware';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  isUuidV4,
  nestedErrors,
  objectErrors,
  oneOfErrors,
  unknownPropertyErrors,
  validateMaxLength
} from '../utils/validation';

const router = Router();

/** The properties of `CreateRoleDto`; `UpdateRoleDto` is its partial. */
const ROLE_BODY_KEYS = ['name', 'description'];

type RoleName = { ok: true; name: string } | { ok: false; error: string };

// CreateRoleDto pairs @Transform(trim) with @IsNotEmpty/@IsString/@MaxLength,
// and UpdateRoleDto inherits them without the null escape hatch.
function normalizeRoleName(value: unknown): RoleName {
  if (typeof value !== 'string') {
    return { ok: false, error: 'name must be a string' };
  }
  const name = value.trim();
  if (name.length === 0) {
    return { ok: false, error: 'name should not be empty' };
  }
  const maxErr = validateMaxLength(name, ROLE_NAME_MAX_LENGTH, 'name');
  return maxErr ? { ok: false, error: maxErr } : { ok: true, name };
}

const CONDITION_KEYS = [
  'effect',
  'ownership',
  'fieldMatch',
  'userAttr',
  'custom'
];
const ASSIGN_PERMISSIONS_KEYS = ['permissionIds', 'conditions'];
const PERMISSION_ITEM_KEYS = ['permissionId', 'conditions'];
const SET_PERMISSIONS_KEYS = ['items'];
const MAX_PERMISSION_ITEMS = 500;

// Mirrors `@IsOptional() @IsObject() @Is<Branch>Shape()`, reported bottom-up.
function conditionBranchErrors(
  field: string,
  value: unknown,
  findShapeError: (value: unknown) => string | null
): string[] {
  if (value === undefined || value === null) return [];
  const shapeError = findShapeError(value);
  return [...(shapeError ? [shapeError] : []), ...objectErrors(field, value)];
}

// Mirrors `@IsOptional() @IsString() @IsSafeMongoQuery()`, reported bottom-up.
function customConditionErrors(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const queryError = findCustomQueryError(value);
  return [
    ...(queryError ? [queryError] : []),
    ...(typeof value === 'string' ? [] : ['custom must be a string'])
  ];
}

// Mirrors PermissionConditionDto, so a payload the real server rejects with
// 400 cannot pass the mock and turn an e2e run false-green.
function conditionObjectErrors(path: string, value: object): string[] {
  const cond = value as Record<string, unknown>;
  return [
    ...unknownPropertyErrors(cond, CONDITION_KEYS),
    ...oneOfErrors('effect', cond['effect'], ['allow', 'deny'], 'nullable'),
    ...conditionBranchErrors(
      'ownership',
      cond['ownership'],
      findOwnershipShapeError
    ),
    ...conditionBranchErrors(
      'fieldMatch',
      cond['fieldMatch'],
      findFieldMatchShapeError
    ),
    ...conditionBranchErrors(
      'userAttr',
      cond['userAttr'],
      findUserAttrShapeError
    ),
    ...customConditionErrors(cond['custom'])
  ].map((message) => `${path}.${message}`);
}

// Mirrors `@IsOptional() @IsObject() @ValidateNested()
// @Type(() => PermissionConditionDto)`.
function conditionsErrors(parentPath: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return nestedErrors(
    parentPath,
    'conditions',
    value,
    objectErrors('conditions', value),
    conditionObjectErrors
  );
}

// Mirrors AssignPermissionsDto. `permissionIds` carries `@IsArray()
// @ArrayNotEmpty() @ArrayMaxSize(500) @IsUUID('4', { each: true })`, reported
// bottom-up.
function assignPermissionsErrors(body: Record<string, unknown>): string[] {
  const ids = body['permissionIds'];
  const isArray = Array.isArray(ids);
  return [
    ...unknownPropertyErrors(body, ASSIGN_PERMISSIONS_KEYS),
    ...((isArray ? ids : [ids]).some((id) => !isUuidV4(id))
      ? ['each value in permissionIds must be a UUID']
      : []),
    ...(!isArray || ids.length > MAX_PERMISSION_ITEMS
      ? [
          `permissionIds must contain no more than ${MAX_PERMISSION_ITEMS} elements`
        ]
      : []),
    ...(!isArray || ids.length === 0
      ? ['permissionIds should not be empty']
      : []),
    ...(isArray ? [] : ['permissionIds must be an array']),
    ...conditionsErrors('', body['conditions'])
  ];
}

// Mirrors PermissionItemDto.
function permissionItemErrors(path: string, value: object): string[] {
  const item = value as Record<string, unknown>;
  return [
    ...[
      ...unknownPropertyErrors(item, PERMISSION_ITEM_KEYS),
      ...(isUuidV4(item['permissionId']) ? [] : ['permissionId must be a UUID'])
    ].map((message) => `${path}.${message}`),
    ...conditionsErrors(path, item['conditions'])
  ];
}

// Mirrors SetPermissionsDto. `items` carries `@IsArray() @ArrayMaxSize(500)
// @IsObject({ each: true }) @ValidateNested({ each: true })`.
function setPermissionsErrors(body: Record<string, unknown>): string[] {
  const items = body['items'];
  const isArray = Array.isArray(items);
  const isPlainObject = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const own = [
    ...((isArray ? items : [items]).some((item) => !isPlainObject(item))
      ? ['each value in items must be an object']
      : []),
    ...(!isArray || items.length > MAX_PERMISSION_ITEMS
      ? [`items must contain no more than ${MAX_PERMISSION_ITEMS} elements`]
      : []),
    ...(isArray ? [] : ['items must be an array'])
  ];
  return [
    ...unknownPropertyErrors(body, SET_PERMISSIONS_KEYS),
    ...nestedErrors('', 'items', items, own, permissionItemErrors, true)
  ];
}

// Mirrors RoleService.assertGrantsApplicable, in the same order: a grant that
// would enforce nothing is rejected on write instead of being stored. Unknown
// permission ids fall through to the unknown-id 400, as on the server.
function findGrantError(
  permissionId: string,
  conditions: unknown
): { message: string; errorKey: string } | null {
  const state = getState();
  const permission = state.permissions.get(permissionId);
  if (!permission) return null;
  const resource = state.resources.get(permission.resourceId);
  const action = state.actions.get(permission.actionId);
  if (!resource || !action) return null;
  const label = `${action.name}:${resource.subject}`;

  if (
    (conditions as PermissionCondition | null)?.effect !== 'deny' &&
    !grantableActionNames(resource).includes(action.name)
  ) {
    return {
      message: `Cannot grant ${label} - the resource does not offer this action`,
      errorKey: ErrorKeys.ROLES.ACTION_NOT_GRANTABLE
    };
  }
  const supportError = findConditionSupportError(
    action.name,
    resource.conditionalActionNames,
    conditions
  );
  if (supportError) {
    return {
      message: `Cannot grant ${label} - ${supportError}`,
      errorKey: ErrorKeys.ROLES.CONDITION_NOT_SUPPORTED
    };
  }
  const actionError = findConditionActionError(action.name, conditions);
  if (actionError) {
    return {
      message: `Cannot grant ${label} - ${actionError}`,
      errorKey: ErrorKeys.ROLES.CONDITION_NOT_APPLICABLE
    };
  }
  const fieldError = findConditionFieldError(resource.subject, conditions);
  if (fieldError) {
    return {
      message: `Cannot grant ${label} - ${fieldError}`,
      errorKey: ErrorKeys.ROLES.CONDITION_FIELD_UNKNOWN
    };
  }
  return null;
}

// Mirrors RoleService.assertNotSystem: a super caller may change the grants of
// a system role, so refusing any other caller is a refusal by privilege.
function refuseSystemRole(req: Request, res: Response, roleId: string): void {
  logRefusal(req, (req as AuthenticatedRequest).user.id, {
    targetId: roleId,
    targetType: 'Role',
    details: { deniedAction: 'update', subject: 'Role', systemRole: true }
  });
  res.status(403).json({
    message: 'Cannot modify system roles',
    statusCode: 403,
    errorKey: ErrorKeys.ROLES.CANNOT_MODIFY_SYSTEM
  });
}

// Mirrors RoleService.refuseSuperRole: no API path assigns or removes a super
// role, a super caller included.
function refuseSuperRole(
  req: Request,
  res: Response,
  action: 'assign' | 'unassign',
  roleId: string
): void {
  logRefusal(req, (req as AuthenticatedRequest).user.id, {
    targetId: roleId,
    targetType: 'Role',
    details: { deniedAction: action, subject: 'Role', superRole: true }
  });
  res.status(403).json({
    message:
      action === 'assign'
        ? 'Cannot assign super roles'
        : 'Cannot remove super roles',
    statusCode: 403,
    errorKey:
      action === 'assign'
        ? ErrorKeys.ROLES.SUPER_ROLE_ASSIGN_FORBIDDEN
        : ErrorKeys.ROLES.SUPER_ROLE_REMOVE_FORBIDDEN
  });
}

// Notify every connected holder of a role that its effective permission set
// changed, so their client refreshes abilities without a reload. Mirrors the
// server's RolePermissionsChangedEvent fan-out (no token revocation).
export function notifyRoleHolders(roleName: string): void {
  for (const user of getState().users.values()) {
    if (user.roles.includes(roleName)) {
      pushToUser(user.id, { type: 'permissions_updated' });
    }
  }
}

// GET /api/v1/roles
// GET /api/v1/roles/cursor
router.get('/cursor', permissionGuard('read', 'Role'), (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = listQueryErrors(query, ROLE_LIST_QUERY);
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  if (rejectInvalidCursor(res, query)) return;
  res.json(
    listPage(Array.from(getState().roles.values()), ROLE_LIST_QUERY, query)
  );
});

router.get('/', permissionGuard('read', 'Role'), (_req, res) => {
  const roles = Array.from(getState().roles.values());

  res.json(roles.sort((a, b) => a.name.localeCompare(b.name)));
});

// GET /api/v1/roles/permissions
router.get('/permissions', permissionGuard('read', 'Role'), (_req, res) => {
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
router.get(
  '/:id/permissions',
  permissionGuard('read', 'Role'),
  requireUuid('id'),
  (req, res) => {
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

    if (!assertInstancePermission(req, res, 'read', 'Role', role)) {
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
  }
);

// GET /api/v1/roles/:id
router.get(
  '/:id',
  permissionGuard('read', 'Role'),
  requireUuid('id'),
  (req, res) => {
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

    if (!assertInstancePermission(req, res, 'read', 'Role', role)) {
      return;
    }

    res.json(role);
  }
);

// POST /api/v1/roles
router.post('/', permissionGuard('create', 'Role'), (req, res) => {
  const { description } = req.body;

  const normalized = normalizeRoleName(req.body.name);
  const errors = [
    ...unknownPropertyErrors(req.body, ROLE_BODY_KEYS),
    ...(normalized.ok ? [] : [normalized.error])
  ];
  if (errors.length > 0 || !normalized.ok) {
    res.status(400).json(validationError(errors));
    return;
  }
  const name = normalized.name;

  // CreateRoleDto carries `name` and `description`; the service raises every
  // check below, so the instance check sits between the pipe and the service.
  if (
    !assertInstancePermission(req, res, 'create', 'Role', { name, description })
  ) {
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
    id: randomUUID(),
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
router.patch(
  '/:id',
  permissionGuard('update', 'Role'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();

    // The server's global ValidationPipe runs before the handler, so a body that
    // fails UpdateRoleDto is a 400 whether or not the role exists.
    const { name, description } = req.body;

    const normalized = name === undefined ? undefined : normalizeRoleName(name);
    const errors = [
      ...unknownPropertyErrors(req.body, ROLE_BODY_KEYS),
      ...(normalized && !normalized.ok ? [normalized.error] : [])
    ];
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
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

    // `RoleService.update` raises the isSystem 400, so it sits below the
    // instance check on the server. The record after the write is checked too.
    if (
      !assertInstancePermission(req, res, 'update', 'Role', role) ||
      !assertInstancePermission(
        req,
        res,
        'update',
        'Role',
        withChanges(role, {
          name: normalized?.ok ? normalized.name : undefined,
          description
        })
      )
    ) {
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

    const changed = changedFields(role, {
      name: normalized?.ok ? normalized.name : undefined,
      description
    });

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
        // Users hold role names here, where the server joins by role id, so
        // the holders follow the rename to keep the role.
        const oldName = role.name;
        role.name = normalized.name;
        for (const user of state.users.values()) {
          user.roles = user.roles.map((r) => (r === oldName ? role.name : r));
        }
        notifyRoleHolders(role.name);
        rewriteRoleNameInRules(oldName, role.name);
        pushUserListStale();
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
      details: { changedFields: changed },
      ip: req.ip
    });

    res.json(role);
  }
);

// DELETE /api/v1/roles/:id
router.delete(
  '/:id',
  permissionGuard('delete', 'Role'),
  requireUuid('id'),
  (req, res) => {
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

    // `RoleService.delete` raises the isSystem 400, so it sits below the
    // instance check on the server.
    if (!assertInstancePermission(req, res, 'delete', 'Role', role)) {
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

    if (!assertGrantScope(req, res, 'lift', id, denyRowsOf(id))) {
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
    rewriteRoleNameInRules(role.name, null);

    for (const userId of holderIds) {
      pushToUser(userId, { type: 'permissions_updated' });
    }
    pushUserListStale();

    const actor = (req as AuthenticatedRequest).user;
    logAudit('ROLE_DELETE', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: id,
      targetType: 'Role',
      details: { name: role.name },
      ip: req.ip
    });

    res.send();
  }
);

// PUT /api/v1/roles/:id/permissions  — replaces the full permission set atomically
router.put(
  '/:id/permissions',
  permissionGuard('update', 'Role'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();

    // SetPermissionsDto is validated by the server's global pipe before the
    // handler runs, so its shape checks precede the role lookup. Everything that
    // needs the role or the permission registry stays below the 404.
    const errors = setPermissionsErrors(req.body);
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }
    const { items } = req.body as {
      items: { permissionId: string; conditions?: unknown }[];
    };

    const role = state.roles.get(id);

    if (!role) {
      res.status(404).json({
        message: 'Role not found',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.NOT_FOUND
      });
      return;
    }

    // `RoleService.assertCanUpdateRole` runs above `assertNotSystem`, so the
    // instance check sits above the isSystem 400 on the server.
    if (!assertInstancePermission(req, res, 'update', 'Role', role)) {
      return;
    }

    if (role.isSystem && !isActorSuper(req)) {
      refuseSystemRole(req, res, role.id);
      return;
    }

    for (const item of items) {
      const error = findGrantError(item.permissionId, item.conditions);
      if (error) {
        res.status(400).json({ ...error, statusCode: 400 });
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

    const grantItems = items.map((item) => ({
      permissionId: item.permissionId,
      conditions: (item.conditions as PermissionCondition | null) ?? null
    }));
    if (!assertGrantScope(req, res, 'grant', id, grantItems)) {
      return;
    }

    // A deny row survives a replace only when it is sent back unchanged.
    const liftedRows = denyRowsOf(id).filter(
      (row) =>
        !grantItems.some(
          (item) =>
            item.permissionId === row.permissionId &&
            sameConditions(item.conditions, row.conditions)
        )
    );
    if (!assertGrantScope(req, res, 'lift', id, liftedRows)) {
      return;
    }

    // Replace all existing assignments for this role
    state.rolePermissions = state.rolePermissions.filter(
      (rp) => rp.roleId !== id
    );

    for (const item of items) {
      state.rolePermissions.push({
        id: randomUUID(),
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
  }
);

// POST /api/v1/roles/:id/permissions
router.post(
  '/:id/permissions',
  permissionGuard('update', 'Role'),
  requireUuid('id'),
  (req, res) => {
    const id = req.params['id'] as string;
    const state = getState();

    // AssignPermissionsDto is validated by the server's global pipe before the
    // handler runs, so its shape checks precede the role lookup. Everything that
    // needs the role or the permission registry stays below the 404.
    const errors = assignPermissionsErrors(req.body);
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }
    const { permissionIds, conditions } = req.body;

    const role = state.roles.get(id);

    if (!role) {
      res.status(404).json({
        message: 'Role not found',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.NOT_FOUND
      });
      return;
    }

    // `RoleService.assertCanUpdateRole` runs above `assertNotSystem`, so the
    // instance check sits above the isSystem 400 on the server.
    if (!assertInstancePermission(req, res, 'update', 'Role', role)) {
      return;
    }

    if (role.isSystem && !isActorSuper(req)) {
      refuseSystemRole(req, res, role.id);
      return;
    }

    for (const permissionId of permissionIds as string[]) {
      const error = findGrantError(permissionId, conditions);
      if (error) {
        res.status(400).json({ ...error, statusCode: 400 });
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

    const grantItems = (permissionIds as string[]).map((permissionId) => ({
      permissionId,
      conditions: (conditions as PermissionCondition | undefined) ?? null
    }));
    if (!assertGrantScope(req, res, 'grant', id, grantItems)) {
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
        id: randomUUID(),
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
  }
);

// DELETE /api/v1/roles/:id/permissions/:permissionId
router.delete(
  '/:id/permissions/:permissionId',
  permissionGuard('update', 'Role'),
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

    // `RoleService.assertCanUpdateRole` runs above `assertNotSystem`, so the
    // instance check sits above the isSystem 400 on the server.
    if (!assertInstancePermission(req, res, 'update', 'Role', role)) {
      return;
    }

    if (role.isSystem && !isActorSuper(req)) {
      refuseSystemRole(req, res, role.id);
      return;
    }

    const removedRows = denyRowsOf(id).filter(
      (row) => row.permissionId === permissionId
    );
    if (!assertGrantScope(req, res, 'lift', id, removedRows)) {
      return;
    }

    if (
      !state.rolePermissions.some(
        (rp) => rp.roleId === id && rp.permissionId === permissionId
      )
    ) {
      res.status(404).json({
        message: 'The role does not hold this permission',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.PERMISSION_NOT_ASSIGNED
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
  permissionGuard('assign', 'Role'),
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

    // `RoleService.assignRoleToUser` refuses a super role to every caller of
    // this route, a super caller included: no API path grants one.
    if (role.isSuper) {
      refuseSuperRole(req, res, 'assign', roleId);
      return;
    }

    // `RoleService.assignRoleToUser` re-checks `update` on the target user,
    // and refuses a super target to a non-super caller, below the super-role
    // test and above the duplicate 409.
    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }
    if (!assertInstancePermission(req, res, 'assign', 'Role', role)) {
      return;
    }

    // `RoleService.assignRoleToUser` checks the rows of the role before the
    // insert that raises the duplicate 409.
    const roleRows = state.rolePermissions.filter((rp) => rp.roleId === roleId);
    if (!assertGrantScope(req, res, 'grant', roleId, roleRows)) {
      return;
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
    revokeUserSessions(user.id);

    const actor = (req as AuthenticatedRequest).user;
    logAudit('ROLE_ASSIGN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId },
      ip: req.ip
    });

    pushUserCrudEvent('updated', userId);
    // The server route is a @Post with no @HttpCode, so Nest answers 201.
    res.status(201).send();
  }
);

// DELETE /api/v1/roles/assign/:userId/:roleId
router.delete(
  '/assign/:userId/:roleId',
  permissionGuard('assign', 'Role'),
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

    // `RoleService.removeRoleFromUser` refuses a super role to every caller of
    // this route, a super caller included: no API path removes one.
    if (role.isSuper) {
      refuseSuperRole(req, res, 'unassign', roleId);
      return;
    }

    if (!assertCanWriteUser(req, res, 'update', user)) {
      return;
    }
    if (!assertInstancePermission(req, res, 'assign', 'Role', role)) {
      return;
    }

    if (!assertGrantScope(req, res, 'lift', roleId, denyRowsOf(roleId))) {
      return;
    }

    if (!user.roles.includes(role.name)) {
      res.status(404).json({
        message: 'The user does not hold this role',
        statusCode: 404,
        errorKey: ErrorKeys.ROLES.ROLE_NOT_ASSIGNED
      });
      return;
    }

    user.roles = user.roles.filter((r) => r !== role.name);

    // Revoke tokens on any role change (mirrors UserRoleChangedListener)
    revokeUserSessions(user.id);

    const actor = (req as AuthenticatedRequest).user;
    logAudit('ROLE_UNASSIGN', {
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId },
      ip: req.ip
    });

    pushUserCrudEvent('updated', userId);
    res.send();
  }
);

export default router;

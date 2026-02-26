import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { findUserById, getState, logAudit } from '../state';
import { adminGuard } from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// GET /api/v1/roles
router.get('/', adminGuard, (_req, res) => {
  const roles = Array.from(getState().roles.values());
  const state = getState();

  const rolesWithPermissions = roles
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((role) => {
      const rps = state.rolePermissions.filter((rp) => rp.roleId === role.id);
      const permissions = rps
        .map((rp) => {
          const perm = state.permissions.get(rp.permissionId);
          return perm ? { ...perm, conditions: rp.conditions } : null;
        })
        .filter(Boolean);
      return { ...role, permissions };
    });

  res.json(rolesWithPermissions);
});

// GET /api/v1/roles/permissions
router.get('/permissions', adminGuard, (_req, res) => {
  const permissions = Array.from(getState().permissions.values());
  permissions.sort((a, b) => {
    const cmp = a.resource.localeCompare(b.resource);
    return cmp !== 0 ? cmp : a.action.localeCompare(b.action);
  });
  res.json(permissions);
});

// GET /api/v1/roles/:id
router.get('/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  const rps = state.rolePermissions.filter((rp) => rp.roleId === id);
  const permissions = rps
    .map((rp) => {
      const perm = state.permissions.get(rp.permissionId);
      return perm ? { ...perm, conditions: rp.conditions } : null;
    })
    .filter(Boolean);

  res.json({ ...role, permissions });
});

// POST /api/v1/roles
router.post('/', adminGuard, (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ message: 'Role name is required', statusCode: 400 });
    return;
  }

  const state = getState();
  for (const existing of state.roles.values()) {
    if (existing.name === name) {
      res.status(400).json({
        message: 'Role with this name already exists',
        statusCode: 400
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

  res.status(201).json({ ...role, permissions: [] });
});

// PATCH /api/v1/roles/:id
router.patch('/:id', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  if (role.isSystem) {
    res.status(400).json({
      message: 'System roles cannot be modified',
      statusCode: 400
    });
    return;
  }

  const { name, description } = req.body;

  if (name !== undefined && name !== role.name) {
    for (const existing of state.roles.values()) {
      if (existing.name === name) {
        res.status(400).json({
          message: 'Role with this name already exists',
          statusCode: 400
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
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  if (role.isSystem) {
    res.status(400).json({
      message: 'System roles cannot be deleted',
      statusCode: 400
    });
    return;
  }

  // Remove role-permission associations
  state.rolePermissions = state.rolePermissions.filter(
    (rp) => rp.roleId !== id
  );

  // Remove role from users
  for (const user of state.users.values()) {
    user.roles = user.roles.filter((r) => r !== role.name);
  }

  state.roles.delete(id);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_DELETE', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    ip: req.ip
  });

  res.json({ message: 'Role deleted successfully' });
});

// POST /api/v1/roles/:id/permissions
router.post('/:id/permissions', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const state = getState();
  const role = state.roles.get(id);

  if (!role) {
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  const { permissionIds, conditions } = req.body;
  if (!Array.isArray(permissionIds)) {
    res
      .status(400)
      .json({ message: 'permissionIds must be an array', statusCode: 400 });
    return;
  }

  for (const permissionId of permissionIds) {
    // Skip if already assigned
    const exists = state.rolePermissions.some(
      (rp) => rp.roleId === id && rp.permissionId === permissionId
    );
    if (exists) continue;

    // Verify permission exists
    if (!state.permissions.has(permissionId)) continue;

    state.rolePermissions.push({
      id: uuidv4(),
      roleId: id,
      permissionId,
      conditions: conditions ?? null
    });
  }

  const actor = (req as AuthenticatedRequest).user;
  logAudit('PERMISSION_ASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    details: { permissionIds },
    ip: req.ip
  });

  res.json({ message: 'Permissions assigned successfully' });
});

// DELETE /api/v1/roles/:id/permissions/:permissionId
router.delete('/:id/permissions/:permissionId', adminGuard, (req, res) => {
  const id = req.params['id'] as string;
  const permissionId = req.params['permissionId'] as string;
  const state = getState();

  state.rolePermissions = state.rolePermissions.filter(
    (rp) => !(rp.roleId === id && rp.permissionId === permissionId)
  );

  const actor = (req as AuthenticatedRequest).user;
  logAudit('PERMISSION_UNASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: id,
    targetType: 'Role',
    details: { permissionId },
    ip: req.ip
  });

  res.json({ message: 'Permission removed successfully' });
});

// POST /api/v1/roles/assign/:userId
router.post('/assign/:userId', adminGuard, (req, res) => {
  const userId = req.params['userId'] as string;
  const { roleId } = req.body;

  const state = getState();
  const user = findUserById(userId);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  const role = state.roles.get(roleId);
  if (!role) {
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  if (!user.roles.includes(role.name)) {
    user.roles.push(role.name);
  }

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_ASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: userId,
    targetType: 'User',
    details: { roleId },
    ip: req.ip
  });

  res.json({ message: 'Role assigned successfully' });
});

// DELETE /api/v1/roles/assign/:userId/:roleId
router.delete('/assign/:userId/:roleId', adminGuard, (req, res) => {
  const userId = req.params['userId'] as string;
  const roleId = req.params['roleId'] as string;

  const state = getState();
  const user = findUserById(userId);
  if (!user) {
    res.status(404).json({ message: 'User not found', statusCode: 404 });
    return;
  }

  const role = state.roles.get(roleId);
  if (!role) {
    res.status(404).json({ message: 'Role not found', statusCode: 404 });
    return;
  }

  user.roles = user.roles.filter((r) => r !== role.name);

  const actor = (req as AuthenticatedRequest).user;
  logAudit('ROLE_UNASSIGN', {
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: userId,
    targetType: 'User',
    details: { roleId },
    ip: req.ip
  });

  res.json({ message: 'Role removed successfully' });
});

export default router;

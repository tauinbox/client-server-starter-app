import type { ResourceResponse, ActionResponse } from './rbac.types';

export type RoleResponse = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PermissionResponse = {
  id: string;
  resource: ResourceResponse;
  action: ActionResponse;
  description: string | null;
  createdAt: string;
};

export type RolePermissionResponse = {
  permission: PermissionResponse;
  conditions: PermissionCondition | null;
};

export type RoleWithPermissionsResponse = RoleResponse & {
  permissions: RolePermissionResponse[];
};

export type PermissionCondition = {
  ownership?: { userField: string };
  fieldMatch?: Record<string, unknown[]>;
  userAttr?: Record<string, unknown>;
  custom?: string;
};

export type ResolvedPermission = {
  resource: string;
  action: string;
  permission: string;
  conditions: PermissionCondition | null;
};

export type PackedRules = unknown[][];

export type UserPermissionsResponse = {
  roles: string[];
  rules: PackedRules;
};

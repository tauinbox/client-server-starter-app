import type { PermissionCondition } from '@app/shared/types';
import type { MockServerApi } from './base.fixture';
import { mockId } from './ids';
import {
  seedActions,
  seedPermissions,
  seedResources,
  seedRolePermissions
} from '../../../mock-server/src/seed';

/** Seeds a role that holds the given `User` actions with their conditions. */
export async function seedUserRole(
  mockServer: MockServerApi,
  name: string,
  grants: Record<string, PermissionCondition | null>
): Promise<void> {
  const roleId = mockId(`role-${name}`);
  const resourceId = seedResources.find((r) => r.subject === 'User')!.id;
  await mockServer.seedRoles([
    {
      id: roleId,
      name,
      description: null,
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }
  ]);
  await mockServer.seedRolePermissions([
    ...seedRolePermissions,
    ...Object.entries(grants).map(([action, conditions]) => {
      const actionId = seedActions.find((a) => a.name === action)!.id;
      const permission = seedPermissions.find(
        (p) => p.resourceId === resourceId && p.actionId === actionId
      )!;
      return {
        id: mockId(`rp-${name}-${action}`),
        roleId,
        permissionId: permission.id,
        conditions
      };
    })
  ]);
}

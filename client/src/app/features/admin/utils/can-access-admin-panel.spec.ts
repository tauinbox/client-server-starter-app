import type { PermissionCheck } from '@features/auth/casl/app-ability';
import { canAccessAdminPanel } from './can-access-admin-panel';

type GrantedCheck = Pick<PermissionCheck, 'action' | 'subject'>;
type HasPermissionsFn = (check: PermissionCheck | PermissionCheck[]) => boolean;

function makeAuthStore(granted: GrantedCheck[]): {
  hasPermissions: ReturnType<typeof vi.fn<HasPermissionsFn>>;
} {
  return {
    hasPermissions: vi.fn<HasPermissionsFn>((check) => {
      const checks = Array.isArray(check) ? check : [check];
      return checks.every(({ action, subject }) =>
        granted.some((g) => g.action === action && g.subject === subject)
      );
    })
  };
}

describe('canAccessAdminPanel', () => {
  it('returns true when user can search User', () => {
    const store = makeAuthStore([{ action: 'search', subject: 'User' }]);
    expect(canAccessAdminPanel(store)).toBe(true);
  });

  it('returns true when user can read Role', () => {
    const store = makeAuthStore([{ action: 'read', subject: 'Role' }]);
    expect(canAccessAdminPanel(store)).toBe(true);
  });

  it('returns true when user can read Permission', () => {
    const store = makeAuthStore([{ action: 'read', subject: 'Permission' }]);
    expect(canAccessAdminPanel(store)).toBe(true);
  });

  it('returns false when user has none of the required permissions', () => {
    const store = makeAuthStore([]);
    expect(canAccessAdminPanel(store)).toBe(false);
  });

  it('short-circuits on the first granted permission', () => {
    const store = makeAuthStore([{ action: 'search', subject: 'User' }]);
    canAccessAdminPanel(store);
    expect(store.hasPermissions).toHaveBeenCalledTimes(1);
  });
});

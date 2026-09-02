import type { PermissionCheck } from '@features/auth/casl/app-ability';
import { canAccessAdminPanel } from './can-access-admin-panel';

type GrantedCheck = Pick<PermissionCheck, 'action' | 'subject'>;
type HasPermissionsFn = (check: PermissionCheck | PermissionCheck[]) => boolean;

function makeAuthStore(
  granted: GrantedCheck[],
  mustEnrolMfa = false
): {
  hasPermissions: ReturnType<typeof vi.fn<HasPermissionsFn>>;
  mustEnrolMfa: () => boolean;
} {
  return {
    hasPermissions: vi.fn<HasPermissionsFn>((check) => {
      const checks = Array.isArray(check) ? check : [check];
      return checks.every(({ action, subject }) =>
        granted.some((g) => g.action === action && g.subject === subject)
      );
    }),
    mustEnrolMfa: () => mustEnrolMfa
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

  it('returns true when user can manage FeatureFlag', () => {
    const store = makeAuthStore([{ action: 'manage', subject: 'FeatureFlag' }]);
    expect(canAccessAdminPanel(store)).toBe(true);
  });

  it('returns true when user can manage Billing', () => {
    const store = makeAuthStore([{ action: 'manage', subject: 'Billing' }]);
    expect(canAccessAdminPanel(store)).toBe(true);
  });

  it('returns false when user has none of the required permissions', () => {
    const store = makeAuthStore([]);
    expect(canAccessAdminPanel(store)).toBe(false);
  });

  it('returns false while the account owes a two-factor enrolment', () => {
    const store = makeAuthStore([{ action: 'search', subject: 'User' }], true);
    expect(canAccessAdminPanel(store)).toBe(false);
    expect(store.hasPermissions).not.toHaveBeenCalled();
  });

  it('short-circuits on the first granted permission', () => {
    const store = makeAuthStore([{ action: 'search', subject: 'User' }]);
    canAccessAdminPanel(store);
    expect(store.hasPermissions).toHaveBeenCalledTimes(1);
  });
});

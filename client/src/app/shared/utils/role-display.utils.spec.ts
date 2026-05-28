import { SYSTEM_ROLES } from '@app/shared/constants';
import {
  isAdminRole,
  overflowRoleNames,
  roleIcon,
  sortRolesForDisplay
} from './role-display.utils';

const role = (id: string, name: string) => ({ id, name });

describe('role-display.utils', () => {
  describe('roleIcon', () => {
    it('maps the admin system role to the admin icon', () => {
      expect(roleIcon(SYSTEM_ROLES.ADMIN)).toBe('admin_panel_settings');
    });

    it('maps the user system role to the person icon', () => {
      expect(roleIcon(SYSTEM_ROLES.USER)).toBe('person');
    });

    it('falls back to the badge icon for any custom role', () => {
      expect(roleIcon('editor')).toBe('badge');
    });
  });

  describe('isAdminRole', () => {
    it('is true only when the name equals SYSTEM_ROLES.ADMIN', () => {
      expect(isAdminRole(role('1', SYSTEM_ROLES.ADMIN))).toBe(true);
      expect(isAdminRole(role('2', SYSTEM_ROLES.USER))).toBe(false);
    });

    // Keying off the constant (not a literal) means a differently-named role
    // never masquerades as admin, even one called "super".
    it('does not treat an arbitrary high-privilege name as admin', () => {
      expect(SYSTEM_ROLES.ADMIN).not.toBe('super');
      expect(isAdminRole(role('3', 'super'))).toBe(false);
    });
  });

  describe('sortRolesForDisplay', () => {
    it('moves the admin role first and keeps the rest in original order', () => {
      const roles = [
        role('1', SYSTEM_ROLES.USER),
        role('2', 'editor'),
        role('3', SYSTEM_ROLES.ADMIN)
      ];
      expect(sortRolesForDisplay(roles).map((r) => r.name)).toEqual([
        SYSTEM_ROLES.ADMIN,
        SYSTEM_ROLES.USER,
        'editor'
      ]);
    });

    it('returns a new array and leaves the input untouched', () => {
      const roles = [role('1', SYSTEM_ROLES.USER)];
      const sorted = sortRolesForDisplay(roles);
      expect(sorted).not.toBe(roles);
      expect(roles.map((r) => r.name)).toEqual([SYSTEM_ROLES.USER]);
    });

    it('handles an empty array', () => {
      expect(sortRolesForDisplay([])).toEqual([]);
    });
  });

  describe('overflowRoleNames', () => {
    it('joins the names of every role after the first', () => {
      const roles = [
        role('1', SYSTEM_ROLES.ADMIN),
        role('2', SYSTEM_ROLES.USER),
        role('3', 'editor')
      ];
      expect(overflowRoleNames(roles)).toBe(`${SYSTEM_ROLES.USER}, editor`);
    });

    it('returns an empty string when there is only one role', () => {
      expect(overflowRoleNames([role('1', SYSTEM_ROLES.ADMIN)])).toBe('');
    });
  });
});

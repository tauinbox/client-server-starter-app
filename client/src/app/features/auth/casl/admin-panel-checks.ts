import type { PermissionCheck } from './app-ability';

/**
 * Each check opens one section of the admin panel. An account that passes one
 * of them is staff.
 */
export const ADMIN_PANEL_CHECKS: readonly PermissionCheck[] = [
  { action: 'search', subject: 'User' },
  { action: 'read', subject: 'Role' },
  { action: 'read', subject: 'Permission' },
  { action: 'search', subject: 'FeatureFlag' },
  { action: 'search', subject: 'Billing' }
];

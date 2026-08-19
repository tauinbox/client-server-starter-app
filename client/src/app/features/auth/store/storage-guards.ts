import type { RbacMetadataResponse, UserResponse } from '@app/shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows a persisted `auth_user` entry. Only the fields the app reads off the
 * store are checked - a rejected value becomes the "no persisted user" state
 * the guards already handle, so this must never repair a partial object.
 */
export function isPersistedUser(value: unknown): value is UserResponse {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['email'] === 'string' &&
    typeof value['firstName'] === 'string' &&
    typeof value['lastName'] === 'string' &&
    Array.isArray(value['roles'])
  );
}

function isCachedResource(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['subject'] === 'string'
  );
}

function isCachedAction(value: unknown): boolean {
  return isRecord(value) && typeof value['name'] === 'string';
}

/**
 * Narrows the cached RBAC metadata. The elements are checked too: `subjectMap`
 * reads `name` and `subject` off every resource, so an array of the wrong shape
 * would still build a corrupt map.
 */
export function isCachedRbacMetadata(
  value: unknown
): value is RbacMetadataResponse {
  return (
    isRecord(value) &&
    Array.isArray(value['resources']) &&
    value['resources'].every(isCachedResource) &&
    Array.isArray(value['actions']) &&
    value['actions'].every(isCachedAction)
  );
}

import { SetMetadata } from '@nestjs/common';

export const RESOURCE_METADATA_KEY = 'resource_metadata';

export interface ResourceMetadata {
  name: string;
  /**
   * CASL subject name for this resource.
   * Must be PascalCase (e.g. 'User', 'AuditLog') — CASL is case-sensitive,
   * so a mismatch with `@Authorize()` decorators silently denies access.
   * `ResourceService.upsertResource()` auto-normalizes to PascalCase on sync.
   */
  subject: string;
  displayName: string;
  /**
   * The actions that `@Authorize()` checks for this subject. These are the
   * only actions a role can be granted on it. `npm run check:permissions`
   * fails when the list and the checks drift apart.
   */
  actions: readonly string[];
  /**
   * The actions whose every route also checks the record itself (`assertCan`
   * on an instance, or a query filter for a list). Only these accept a grant
   * condition; elsewhere a condition would restrict nothing.
   */
  conditionalActions: readonly string[];
}

export const RegisterResource = (meta: ResourceMetadata) =>
  SetMetadata(RESOURCE_METADATA_KEY, meta);

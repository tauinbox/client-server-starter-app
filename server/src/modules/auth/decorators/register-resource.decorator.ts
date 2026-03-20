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
}

export const RegisterResource = (meta: ResourceMetadata) =>
  SetMetadata(RESOURCE_METADATA_KEY, meta);

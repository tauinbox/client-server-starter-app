import { SetMetadata } from '@nestjs/common';

export const RESOURCE_METADATA_KEY = 'resource_metadata';

export interface ResourceMetadata {
  name: string;
  subject: string;
  displayName: string;
}

export const RegisterResource = (meta: ResourceMetadata) =>
  SetMetadata(RESOURCE_METADATA_KEY, meta);

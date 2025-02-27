import { SetMetadata } from '@nestjs/common';
import { FeatureRolesEnum } from '../enums/feature-roles.enum';
import { MetadataKeysEnum } from '../enums/metadata-keys.enum';

export const FeatureRoles = (...roles: FeatureRolesEnum[]) =>
  SetMetadata(MetadataKeysEnum.Roles, roles);

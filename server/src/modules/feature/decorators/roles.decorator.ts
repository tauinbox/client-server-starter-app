import { SetMetadata } from '@nestjs/common';
import { RolesEnum } from '../enums/roles.enum';
import { MetadataKeysEnum } from '../enums/metadata-keys.enum';

export const Roles = (...roles: RolesEnum[]) =>
  SetMetadata(MetadataKeysEnum.Roles, roles);

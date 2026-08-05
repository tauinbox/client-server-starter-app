import { PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

// skipNullProperties: false makes every inherited property reject an explicit
// null instead of treating it as absent. roles.name is NOT NULL; description
// keeps its own @IsOptional() and stays nullable.
export class UpdateRoleDto extends PartialType(CreateRoleDto, {
  skipNullProperties: false
}) {}

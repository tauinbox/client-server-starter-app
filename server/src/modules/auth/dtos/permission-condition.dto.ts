import { IsIn, IsOptional, IsObject, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { PermissionEffect } from '@app/shared/types';
import { IsSafeMongoQuery } from '../../../common/validators/is-safe-mongo-query.validator';

export class PermissionConditionDto {
  @ApiPropertyOptional({
    description:
      'Rule effect — "allow" (default) grants, "deny" revokes matching access. Deny rules are applied after allow rules and override them (CASL last-matching semantics).',
    enum: ['allow', 'deny'],
    example: 'deny'
  })
  @IsOptional()
  @IsIn(['allow', 'deny'])
  effect?: PermissionEffect;

  @ApiPropertyOptional({
    description: 'Ownership condition — record[userField] must equal userId',
    example: { userField: 'createdBy' }
  })
  @IsOptional()
  @IsObject()
  ownership?: { userField: string };

  @ApiPropertyOptional({
    description:
      'Field match condition — record[field] must be one of the allowed values',
    example: { status: ['draft', 'review'] }
  })
  @IsOptional()
  @IsObject()
  fieldMatch?: Record<string, unknown[]>;

  @ApiPropertyOptional({
    description:
      'User attribute condition — record[field] must equal user[attrName]',
    example: { departmentId: 'departmentId' }
  })
  @IsOptional()
  @IsObject()
  userAttr?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Raw MongoQuery JSON. Only safe operators allowed ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $nor, $not, $exists, $regex, $options, $all, $size, $mod, $elemMatch). $where, $function, $expr are banned.',
    example: '{"status":{"$in":["active","pending"]}}'
  })
  @IsOptional()
  @IsString()
  @IsSafeMongoQuery()
  custom?: string;
}

import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    description: 'Whether the user is an admin',
    example: false
  })
  isAdmin?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the user is active',
    example: true
  })
  isActive?: boolean;
}

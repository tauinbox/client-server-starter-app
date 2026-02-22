import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    description: 'Whether the user is active',
    example: true
  })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Set to true to unlock a locked account',
    example: true
  })
  unlockAccount?: boolean;
}

import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';

export class InitiateEmailChangeDto {
  @ApiProperty({
    description: 'New email address to change to',
    example: 'new.user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(255)
  newEmail: string;

  @ApiProperty({
    description: 'Current password — required to authorize the change',
    example: 'CurrentPassword123'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;
}

import { IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import { MAX_EMAIL_LENGTH } from '@app/shared/constants';
import { StepUpFactorsDto } from './step-up-factors.dto';

export class InitiateEmailChangeDto extends StepUpFactorsDto {
  @ApiProperty({
    description: 'New email address to change to',
    example: 'new.user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  newEmail: string;
}

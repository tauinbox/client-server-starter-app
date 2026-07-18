import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;
}

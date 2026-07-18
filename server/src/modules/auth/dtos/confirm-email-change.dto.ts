import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'Email-change confirmation token sent to the new address'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;
}

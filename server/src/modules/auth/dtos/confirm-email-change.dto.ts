import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmEmailChangeDto {
  @ApiProperty({
    description: 'Email-change confirmation token sent to the new address'
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

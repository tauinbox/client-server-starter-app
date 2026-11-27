import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetRegionStatusDto {
  @ApiProperty({ description: 'True when the region takes new accounts' })
  @IsBoolean()
  public: boolean;
}

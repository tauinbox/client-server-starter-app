import { ApiProperty } from '@nestjs/swagger';
import { Optional } from '@nestjs/common';

export class FeatureConfigDto {
  @ApiProperty({ description: 'External API URL' })
  @Optional()
  api?: string;

  @ApiProperty({ description: 'External API token' })
  @Optional()
  token?: string;
}

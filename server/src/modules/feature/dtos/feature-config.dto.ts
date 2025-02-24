import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class FeatureConfigDto {
  @ApiProperty({ description: 'External API URL' })
  @IsOptional()
  api?: string;

  @ApiProperty({ description: 'External API token' })
  @IsOptional()
  token?: string;
}

import { ApiProperty } from '@nestjs/swagger';

export class FeatureUploadDto {
  @ApiProperty({ description: 'Unique name of stored file' })
  filename: string;
}

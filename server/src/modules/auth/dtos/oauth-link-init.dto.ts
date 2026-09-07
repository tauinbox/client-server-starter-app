import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class OAuthLinkInitDto {
  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it. An account ' +
      'created through a provider holds none and authorizes the link with a ' +
      're-authentication proof instead.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;
}

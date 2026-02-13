import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform
} from '@nestjs/common';
import { FeatureEntityCreateDto } from '../dtos/feature-entity-create.dto';

@Injectable()
export class NameValidatorPipe implements PipeTransform {
  transform(
    value: FeatureEntityCreateDto,
    metadata: ArgumentMetadata
  ): FeatureEntityCreateDto {
    if (metadata.type !== 'body') {
      // apply the pipe only to the request body (which was defined by the @Body decorator)
      return value;
    }

    // metadata.data - if we choose a specific filed in @Body('someProperty') it will contain 'someProperty'
    // metadata.metatype will return type of 'someProperty'

    const regex = /^\D*$/;

    if (!regex.test(value.name)) {
      throw new BadRequestException('Name should not contain digits');
    }

    return value;
  }
}

import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH
} from '@app/shared/constants';

/**
 * The rules of every field that SETS a password. A field that only verifies a
 * password keeps its own rules. `applyDecorators` registers the list in order,
 * while a decorator stack registers bottom-up, so the list is the reverse of
 * `@IsString() @IsNotEmpty() @MinLength() @MaxLength()`. The list of messages
 * is thus MaxLength, MinLength, IsNotEmpty, IsString.
 */
export const IsNewPassword = (): PropertyDecorator =>
  applyDecorators(
    MaxLength(MAX_PASSWORD_LENGTH),
    MinLength(MIN_PASSWORD_LENGTH),
    IsNotEmpty(),
    IsString()
  );

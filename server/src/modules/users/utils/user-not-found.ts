import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';

export function userNotFound(id: string): ApiError {
  return new ApiError(
    ErrorKeys.USERS.NOT_FOUND,
    `User with ID ${id} not found`
  );
}

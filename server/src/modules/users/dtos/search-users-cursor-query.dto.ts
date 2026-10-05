import { USER_LIST_QUERY } from '@app/shared/constants';
import { ListCursorQueryDto } from '../../../common/dtos';

/**
 * Both user list routes take this DTO. `role` (a join) and `includeDeleted` (a
 * scope switch) are `params` of the list definition: validated here, applied
 * by the service.
 */
export class SearchUsersCursorQueryDto extends ListCursorQueryDto(
  USER_LIST_QUERY
) {}

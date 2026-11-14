import { USER_NOTIFICATION_LIST_QUERY } from '@app/shared/constants';
import { ListCursorQueryDto } from '../../../common/dtos';

export class UserNotificationCursorQueryDto extends ListCursorQueryDto(
  USER_NOTIFICATION_LIST_QUERY
) {}

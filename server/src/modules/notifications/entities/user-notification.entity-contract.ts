import type { UserNotification } from './user-notification.entity';
import type { UserNotificationResponse, _AssertNever } from '@app/shared/types';

/** The owner is the caller of every route, so the wire does not repeat it. */
type _ExcludedFields = 'userId';

type _EntityFieldCoverage = _AssertNever<
  Exclude<
    keyof UserNotification,
    keyof UserNotificationResponse | _ExcludedFields
  >
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof UserNotificationResponse, keyof UserNotification>
>;

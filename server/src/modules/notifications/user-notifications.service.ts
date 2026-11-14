import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ErrorKeys, USER_NOTIFICATION_LIST_QUERY } from '@app/shared/constants';
import type {
  UserNotificationContent,
  UserNotificationUnreadCountResponse
} from '@app/shared/types';
import { ApiError } from '../../common/errors/api-error';
import type { CursorPaginatedResponseDto } from '../../common/dtos';
import {
  applyList,
  type ListColumns
} from '../../common/utils/apply-list-query.util';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/services/users.service';
import { UserNotification } from './entities/user-notification.entity';
import { NotificationsService } from './notifications.service';
import type { UserNotificationCursorQueryDto } from './dtos/user-notification-cursor-query.dto';

const USER_NOTIFICATION_LIST_COLUMNS: ListColumns<
  typeof USER_NOTIFICATION_LIST_QUERY
> = {
  search: {},
  filters: {},
  sort: { createdAt: 'notice.createdAt' },
  id: 'notice.id'
};

/**
 * The stored notices of a user. A notice is a row first: the stream push and
 * the mail only announce it, so a user with no open tab and no working mail
 * still finds it in the list.
 */
@Injectable()
export class UserNotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notices: Repository<UserNotification>,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly mail: MailService
  ) {}

  /**
   * Stores the notice, tells the open tabs of the user and sends the mail. A
   * deleted user gets nothing. The mail is best effort: `MailService` logs a
   * failure and does not throw it.
   */
  async notify(
    userId: string,
    content: UserNotificationContent
  ): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) return;

    await this.notices.insert({
      userId,
      kind: content.kind,
      payload: content.payload
    });
    this.notifications.push(userId, { type: 'notification_created' });
    await this.mail.sendUserNotice(user.email, content, user.locale);
  }

  list(
    userId: string,
    query: UserNotificationCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<UserNotification>> {
    const qb = this.notices
      .createQueryBuilder('notice')
      .where('notice.userId = :userId', { userId });

    return applyList(
      qb,
      {
        spec: USER_NOTIFICATION_LIST_QUERY,
        columns: USER_NOTIFICATION_LIST_COLUMNS
      },
      query
    );
  }

  async unreadCount(
    userId: string
  ): Promise<UserNotificationUnreadCountResponse> {
    return {
      unread: await this.notices.count({ where: { userId, readAt: IsNull() } })
    };
  }

  /**
   * Marks one notice of the caller as read. A notice that is already read
   * stays as it is. A notice of another user answers as a missing one, so the
   * answer does not tell that the id exists.
   */
  async markRead(userId: string, id: string): Promise<void> {
    const applied = await this.notices.update(
      { id, userId, readAt: IsNull() },
      { readAt: new Date() }
    );

    if (applied.affected) return;

    if (!(await this.notices.exists({ where: { id, userId } }))) {
      throw new ApiError(
        ErrorKeys.NOTIFICATIONS.NOT_FOUND,
        'Notification not found'
      );
    }
  }
}

// Stored notices against a real PostgreSQL: the keyset pages, the owner
// scope of every read and write, and the guarded read flip.

import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type { UserNotificationContent } from '@app/shared/types';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { UserNotification } from '../src/modules/notifications/entities/user-notification.entity';
import { UserNotificationsService } from '../src/modules/notifications/user-notifications.service';
import type { UserNotificationCursorQueryDto } from '../src/modules/notifications/dtos/user-notification-cursor-query.dto';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PAID: UserNotificationContent = {
  kind: 'invoice_paid',
  payload: {
    invoiceId: '00000000-0000-0000-0000-000000000001',
    amountMinor: 99000,
    currency: 'RUB'
  }
};

function query(
  overrides: Partial<UserNotificationCursorQueryDto> = {}
): UserNotificationCursorQueryDto {
  return { limit: 2, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

runWithInfra('Stored user notices on real PostgreSQL (e2e)', () => {
  let ds: DataSource;
  let push: jest.Mock;
  let sendUserNotice: jest.Mock;
  let service: UserNotificationsService;
  const userIds: string[] = [];

  async function makeUser(locale = 'en'): Promise<User> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `notices-${stamp}@example.com`,
        name: 'Notice Owner',
        password: 'hashed',
        locale
      })
    );

    userIds.push(user.id);

    return user;
  }

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
  });

  beforeEach(() => {
    push = jest.fn();
    sendUserNotice = jest.fn().mockResolvedValue(undefined);
    service = new UserNotificationsService(
      ds.getRepository(UserNotification),
      // @ts-expect-error only `push` is used
      { push },
      // The same lookup as UsersService.findById: soft-deleted rows are out.
      { findById: (id: string) => ds.getRepository(User).findOneBy({ id }) },
      { sendUserNotice }
    );
  });

  afterEach(async () => {
    // The notices go with their users (ON DELETE CASCADE).
    await ds.getRepository(User).delete(userIds.splice(0));
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('stores the notice, tells the open tabs and mails it in the locale of the user', async () => {
    const user = await makeUser('ru');

    await service.notify(user.id, PAID);

    const rows = await ds
      .getRepository(UserNotification)
      .findBy({ userId: user.id });

    expect(rows).toEqual([expect.objectContaining({ ...PAID, readAt: null })]);
    expect(push).toHaveBeenCalledWith(user.id, {
      type: 'notification_created'
    });
    expect(sendUserNotice).toHaveBeenCalledWith(user.email, PAID, 'ru');
  });

  it('gives a soft-deleted user no notice, no push and no mail', async () => {
    const user = await makeUser();

    await ds.getRepository(User).softDelete({ id: user.id });
    await service.notify(user.id, PAID);

    await expect(
      ds.getRepository(UserNotification).countBy({ userId: user.id })
    ).resolves.toBe(0);
    expect(push).not.toHaveBeenCalled();
    expect(sendUserNotice).not.toHaveBeenCalled();
  });

  it('pages the notices of the caller only, newest first', async () => {
    const owner = await makeUser();
    const other = await makeUser();

    for (let i = 0; i < 3; i++) await service.notify(owner.id, PAID);

    await service.notify(other.id, PAID);

    const first = await service.list(owner.id, query());
    const second = await service.list(
      owner.id,
      query({ cursor: first.meta.nextCursor ?? undefined })
    );
    const ids = [...first.data, ...second.data].map(({ id }) => id);
    const stored = await ds.getRepository(UserNotification).find({
      where: { userId: owner.id },
      order: { createdAt: 'DESC', id: 'DESC' }
    });

    expect(first.data).toHaveLength(2);
    expect(second.meta.hasMore).toBe(false);
    expect(ids).toEqual(stored.map(({ id }) => id));
  });

  it('counts the unread notices of the caller only', async () => {
    const owner = await makeUser();
    const other = await makeUser();

    await service.notify(owner.id, PAID);
    await service.notify(owner.id, PAID);
    await service.notify(other.id, PAID);
    const [read] = (await service.list(owner.id, query())).data;

    await service.markRead(owner.id, read.id);

    await expect(service.unreadCount(owner.id)).resolves.toEqual({
      unread: 1
    });
  });

  it('marks a notice read once and keeps the first read time', async () => {
    const owner = await makeUser();

    await service.notify(owner.id, PAID);
    const [notice] = (await service.list(owner.id, query())).data;
    const repo = ds.getRepository(UserNotification);

    await service.markRead(owner.id, notice.id);
    const { readAt: first } = await repo.findOneByOrFail({ id: notice.id });

    await service.markRead(owner.id, notice.id);
    const { readAt: again } = await repo.findOneByOrFail({ id: notice.id });

    expect(first).toBeInstanceOf(Date);
    expect(again).toEqual(first);
  });

  it('answers a notice of another user as a missing one and leaves it unread', async () => {
    const owner = await makeUser();
    const intruder = await makeUser();

    await service.notify(owner.id, PAID);
    const [notice] = (await service.list(owner.id, query())).data;

    await expect(
      service.markRead(intruder.id, notice.id)
    ).rejects.toMatchObject({
      errorKey: ErrorKeys.NOTIFICATIONS.NOT_FOUND
    });
    await expect(
      ds.getRepository(UserNotification).findOneByOrFail({ id: notice.id })
    ).resolves.toMatchObject({ readAt: null });
  });
});

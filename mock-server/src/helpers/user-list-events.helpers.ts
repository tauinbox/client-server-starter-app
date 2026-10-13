import { subject as caslSubject } from '@casl/ability';
import type { MockUser } from '../types';
import {
  buildAbilityForUser,
  findUserById,
  findUserByIdWithDeleted
} from '../state';
import { pushToUsersMatching } from '../sse-hub';

type UserCrudAction = 'created' | 'updated' | 'deleted' | 'restored';

function abilityOfConnected(connectedUserId: string) {
  const viewer = findUserById(connectedUserId);
  return viewer === undefined ? undefined : buildAbilityForUser(viewer);
}

// Only to the viewers whose list shows the user: a `search` grant can carry
// conditions, so the check runs on the record, and on `previous` too.
export function pushUserCrudEvent(
  action: UserCrudAction,
  userId: string,
  previous?: MockUser
): void {
  const user = findUserByIdWithDeleted(userId);
  if (!user) return;
  const records = [user, ...(previous ? [previous] : [])].map((row) =>
    caslSubject('User', row)
  );
  pushToUsersMatching(
    (connectedUserId) => {
      const ability = abilityOfConnected(connectedUserId);
      return records.some((record) => ability?.can('search', record) ?? false);
    },
    { type: 'user_crud_events', action, userId }
  );
}

export function pushUserListStale(): void {
  pushToUsersMatching(
    (connectedUserId) =>
      abilityOfConnected(connectedUserId)?.can('search', 'User') ?? false,
    { type: 'user_list_stale' }
  );
}

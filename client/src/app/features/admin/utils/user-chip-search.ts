import type { Observable, OperatorFunction } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import type { ChipOption } from '@shared/forms';
import type { UserService } from '@features/users/services/user.service';
import type { User } from '@features/users/models/user.types';

/** Idle time before a typed term reaches the users search endpoint. */
export const USER_SEARCH_DEBOUNCE_MS = 350;

/** Shortest term worth a request - anything shorter yields no options. */
export const USER_SEARCH_MIN_CHARS = 3;

/** Page size of a user search request. A full page means more may exist. */
export const USER_SEARCH_LIMIT = 10;

/**
 * Chip for a user: the display name when there is one, the email otherwise,
 * with the email always available as the disambiguating sub-label.
 */
export function userToChip(user: User): ChipOption {
  return {
    value: user.id,
    label: `${user.firstName} ${user.lastName}`.trim() || user.email,
    sub: user.email
  };
}

/** Chip for a role, keyed by role name since that is what rules reference. */
export function roleToChip(role: RoleAdminResponse): ChipOption {
  return {
    value: role.name,
    label: role.name,
    sub: role.description ?? undefined
  };
}

/**
 * One page of users matching `term`, newest first. Callers are responsible for
 * skipping terms shorter than `USER_SEARCH_MIN_CHARS`.
 */
export function searchUsersPage(
  userService: UserService,
  term: string
): Observable<User[]> {
  return userService
    .searchCursor(
      { q: term },
      { limit: USER_SEARCH_LIMIT, sortBy: 'createdAt', sortOrder: 'desc' }
    )
    .pipe(map((r) => r.data));
}

/**
 * Turns a stream of typed terms into a stream of results: debounced, deduped,
 * and switched so a stale response can never overwrite a newer one.
 */
export function debouncedUserSearch(
  search: (term: string) => Observable<User[]>
): OperatorFunction<string, User[]> {
  return (terms$) =>
    terms$.pipe(
      debounceTime(USER_SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap((term) => search(term))
    );
}

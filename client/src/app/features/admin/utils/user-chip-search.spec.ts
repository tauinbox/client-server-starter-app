import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { toArray } from 'rxjs';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import { UserService } from '@features/users/services/user.service';
import type { User } from '@features/users/models/user.types';
import {
  debouncedUserSearch,
  roleToChip,
  searchUsersPage,
  USER_SEARCH_DEBOUNCE_MS,
  USER_SEARCH_LIMIT,
  userToChip
} from './user-chip-search';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    roles: [],
    isEmailVerified: true,
    locale: 'en',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...overrides
  };
}

function makeRole(
  overrides: Partial<RoleAdminResponse> = {}
): RoleAdminResponse {
  return {
    id: 'r-1',
    name: 'admin',
    description: 'System admins',
    isSystem: true,
    isSuper: false,
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

describe('userToChip', () => {
  it('labels the chip with the full name and keeps the email as sub-label', () => {
    expect(userToChip(makeUser())).toEqual({
      value: 'u-1',
      label: 'Ada Lovelace',
      sub: 'ada@example.com'
    });
  });

  it('falls back to the email when the user has no name', () => {
    const chip = userToChip(makeUser({ firstName: '', lastName: '' }));
    expect(chip.label).toBe('ada@example.com');
  });
});

describe('roleToChip', () => {
  it('keys the chip by role name and carries the description', () => {
    expect(roleToChip(makeRole())).toEqual({
      value: 'admin',
      label: 'admin',
      sub: 'System admins'
    });
  });

  it('drops a null description instead of rendering it', () => {
    expect(roleToChip(makeRole({ description: null })).sub).toBeUndefined();
  });
});

describe('searchUsersPage', () => {
  it('requests one newest-first page and unwraps the cursor envelope', async () => {
    const user = makeUser();
    const searchCursor = vi
      .fn()
      .mockReturnValue(of({ data: [user], meta: { nextCursor: null } }));

    TestBed.configureTestingModule({
      providers: [{ provide: UserService, useValue: { searchCursor } }]
    });

    const result = await firstValueFrom(
      searchUsersPage(TestBed.inject(UserService), 'ada')
    );

    expect(result).toEqual([user]);
    expect(searchCursor).toHaveBeenCalledWith(
      { q: 'ada' },
      { limit: USER_SEARCH_LIMIT, sortBy: 'createdAt', sortOrder: 'desc' }
    );
  });
});

describe('debouncedUserSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches only the settled term and skips repeats of it', () => {
    const search = vi.fn((term: string) => of([makeUser({ id: term })]));
    const terms$ = new Subject<string>();
    const seen: User[][] = [];

    terms$.pipe(debouncedUserSearch(search)).subscribe((u) => seen.push(u));

    terms$.next('ad');
    terms$.next('ada');
    vi.advanceTimersByTime(USER_SEARCH_DEBOUNCE_MS);
    terms$.next('ada');
    vi.advanceTimersByTime(USER_SEARCH_DEBOUNCE_MS);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('ada');
    expect(seen).toEqual([[makeUser({ id: 'ada' })]]);
  });

  it('drops an in-flight response once a newer term arrives', async () => {
    const slow = new Subject<User[]>();
    const search = vi.fn((term: string) =>
      term === 'ada' ? slow : of([makeUser({ id: term })])
    );
    const terms$ = new Subject<string>();
    const collected = firstValueFrom(
      terms$.pipe(debouncedUserSearch(search), toArray())
    );

    terms$.next('ada');
    vi.advanceTimersByTime(USER_SEARCH_DEBOUNCE_MS);
    terms$.next('adam');
    vi.advanceTimersByTime(USER_SEARCH_DEBOUNCE_MS);

    slow.next([makeUser({ id: 'stale' })]);
    terms$.complete();

    expect(await collected).toEqual([[makeUser({ id: 'adam' })]]);
  });
});

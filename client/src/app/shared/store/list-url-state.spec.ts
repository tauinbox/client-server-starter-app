import { convertToParamMap, DefaultUrlSerializer } from '@angular/router';
import {
  FEATURE_FLAG_LIST_QUERY,
  INVOICE_LIST_QUERY,
  MAX_LIST_FILTER_LENGTH,
  ROLE_LIST_QUERY,
  SUBSCRIPTION_LIST_QUERY,
  USER_LIST_QUERY
} from '@app/shared/constants';
import {
  isListUrlCanonical,
  LIST_URL_KEYS,
  listUrlParams,
  readListUrl
} from './list-url-state';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('list URL state', () => {
  it('gives every list its own key, with no dot in it', () => {
    expect(new Set(LIST_URL_KEYS).size).toBe(LIST_URL_KEYS.length);
    for (const key of LIST_URL_KEYS) {
      expect(key).toMatch(/^[a-z]+$/);
    }
  });

  describe('readListUrl', () => {
    it('reads the search, each filter kind, a param and the sort', () => {
      const state = readListUrl(
        convertToParamMap({
          'users.q': 'ali',
          'users.isActive': 'false',
          'users.mfaEnabled': 'true',
          'users.ids': `${ID_A},${ID_B}`,
          'users.role': 'editor',
          'users.sortBy': 'email',
          'users.sortOrder': 'asc'
        }),
        'users',
        USER_LIST_QUERY
      );

      expect(state).toEqual({
        filters: {
          q: 'ali',
          isActive: false,
          mfaEnabled: true,
          ids: [ID_A, ID_B],
          role: 'editor'
        },
        sortBy: 'email',
        sortOrder: 'asc'
      });
    });

    it('drops each value the server would reject, and keeps the rest', () => {
      const state = readListUrl(
        convertToParamMap({
          'users.q': 'x'.repeat(MAX_LIST_FILTER_LENGTH + 1),
          'users.isActive': 'yes',
          'users.ids': `${ID_A},not-a-uuid`,
          'users.email': ['a', 'b'],
          'users.unknown': '1',
          'users.isLocked': 'true',
          'users.sortBy': 'password',
          'users.sortOrder': 'up'
        }),
        'users',
        USER_LIST_QUERY
      );

      expect(state).toEqual({
        filters: { isLocked: true },
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    it('accepts a scope value only from its list', () => {
      const read = (environment: string) =>
        readListUrl(
          convertToParamMap({ 'flags.environment': environment }),
          'flags',
          FEATURE_FLAG_LIST_QUERY
        ).filters;

      expect(read('production')).toEqual({ environment: 'production' });
      expect(read('moon')).toEqual({});
    });

    it('reads no search for a list without one', () => {
      expect(
        readListUrl(
          convertToParamMap({ 'invoices.q': 'x' }),
          'invoices',
          INVOICE_LIST_QUERY
        ).filters
      ).toEqual({});
    });

    it('keeps two lists with the same param names apart on one URL', () => {
      const params = convertToParamMap({
        'subs.sortBy': 'status',
        'invoices.sortBy': 'createdAt',
        'invoices.sortOrder': 'asc'
      });

      expect(readListUrl(params, 'subs', SUBSCRIPTION_LIST_QUERY)).toEqual({
        filters: {},
        sortBy: 'status',
        sortOrder: 'desc'
      });
      expect(readListUrl(params, 'invoices', INVOICE_LIST_QUERY)).toEqual({
        filters: {},
        sortBy: 'createdAt',
        sortOrder: 'asc'
      });
    });
  });

  describe('listUrlParams', () => {
    it('writes active values and clears defaults and empty values', () => {
      expect(
        listUrlParams('flags', FEATURE_FLAG_LIST_QUERY, {
          filters: { q: 'beta', enabled: false, public: undefined },
          sortBy: 'createdAt',
          sortOrder: 'desc'
        })
      ).toEqual({
        'flags.q': 'beta',
        'flags.enabled': 'false',
        'flags.public': null,
        'flags.environment': null,
        'flags.sortBy': null,
        'flags.sortOrder': null
      });
    });

    it('round-trips special characters through the URL and through returnUrl', () => {
      const serializer = new DefaultUrlSerializer();
      const q = 'a&b #c%d+e ж';
      const tree = serializer.parse('/admin/users');
      const written = Object.entries(
        listUrlParams('users', USER_LIST_QUERY, {
          filters: { q },
          sortBy: 'createdAt',
          sortOrder: 'desc'
        })
      ).filter(([, value]) => value !== null);
      tree.queryParams = { ...Object.fromEntries(written), returnUrl: '/x' };
      const url = serializer.serialize(tree);
      const login = serializer.parse('/login');
      login.queryParams = { returnUrl: url };
      const back = serializer.parse(serializer.serialize(login)).queryParams[
        'returnUrl'
      ] as string;

      const state = readListUrl(
        serializer.parse(back).queryParamMap,
        'users',
        USER_LIST_QUERY
      );
      expect(state.filters).toEqual({ q });
      expect(serializer.parse(back).queryParams['returnUrl']).toBe('/x');
    });
  });

  describe('isListUrlCanonical', () => {
    const canonicalOf = (params: Record<string, string | string[]>) => {
      const map = convertToParamMap(params);
      const state = readListUrl(map, 'roles', ROLE_LIST_QUERY);
      return isListUrlCanonical(
        map,
        'roles',
        listUrlParams('roles', ROLE_LIST_QUERY, state)
      );
    };

    it('accepts the canonical form and the params of other lists', () => {
      expect(
        canonicalOf({
          'roles.isSystem': 'true',
          'users.q': 'x',
          returnUrl: '/'
        })
      ).toBe(true);
    });

    it('rejects an invalid, unknown, repeated or default param', () => {
      expect(canonicalOf({ 'roles.isSystem': 'maybe' })).toBe(false);
      expect(canonicalOf({ 'roles.junk': '1' })).toBe(false);
      expect(canonicalOf({ 'roles.q': ['a', 'b'] })).toBe(false);
      expect(canonicalOf({ 'roles.sortBy': 'createdAt' })).toBe(false);
    });
  });
});

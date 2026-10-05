import { DataSource } from 'typeorm';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { ListQuerySpec } from '@app/shared/types';
import { applyListQuery, type ListQueryColumns } from './apply-list-query.util';

const SPEC = {
  search: ['name', 'description'],
  filters: {
    active: { kind: 'boolean' },
    email: { kind: 'contains' },
    ids: { kind: 'uuidList', field: 'id' },
    region: { kind: 'scopeIncludes', field: 'regions', values: ['eu', 'us'] },
    hasOwner: { kind: 'isSet', field: 'ownerId' },
    isExpired: { kind: 'inFuture', field: 'expiresAt' }
  },
  sort: ['createdAt']
} as const satisfies ListQuerySpec;

const COLUMNS: ListQueryColumns<typeof SPEC> = {
  search: { name: 'item.name', description: 'item.description' },
  filters: {
    active: 'item.active',
    email: 'item.email',
    ids: 'item.id',
    region: 'item.regions',
    hasOwner: 'item.ownerId',
    isExpired: 'item.expiresAt'
  }
};

// A real builder renders the SQL that Postgres would run; no connection is
// opened to build it.
const dataSource = new DataSource({ type: 'postgres' });

function builder(): SelectQueryBuilder<ObjectLiteral> {
  return dataSource
    .createQueryBuilder()
    .select('item.id')
    .from('items', 'item')
    .where('item.tenant = :tenant', { tenant: 't1' });
}

function render(qb: SelectQueryBuilder<ObjectLiteral>): {
  where: string;
  params: Record<string, unknown>;
} {
  const where = qb.getQuery().split(' WHERE ')[1] ?? '';
  return { where, params: qb.getParameters() };
}

describe('applyListQuery', () => {
  it('adds nothing for an empty query', () => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, {});

    expect(render(qb).where).toBe('item.tenant = :tenant');
  });

  it('ORs the search over every search column and ANDs it to the existing condition', () => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, { q: 'abc' });

    const { where, params } = render(qb);
    expect(where).toBe(
      'item.tenant = :tenant AND (item.name ILIKE :listSearch OR item.description ILIKE :listSearch)'
    );
    expect(params['listSearch']).toBe('%abc%');
  });

  it('escapes the LIKE wildcards of the search and of a contains filter', () => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, { q: '50%_a\\b', email: '%' });

    const { params } = render(qb);
    expect(params['listSearch']).toBe('%50\\%\\_a\\\\b%');
    expect(params['listFilter_email']).toBe('%\\%%');
  });

  it('applies each filter kind on its own column', () => {
    const qb = builder();
    const ids = ['00000000-0000-4000-8000-000000000001'];

    applyListQuery(qb, SPEC, COLUMNS, {
      active: false,
      email: 'ann',
      ids
    });

    const { where, params } = render(qb);
    expect(where).toBe(
      'item.tenant = :tenant AND item.active = :listFilter_active AND item.email ILIKE :listFilter_email AND item.id IN (:...listFilter_ids)'
    );
    expect(params).toMatchObject({
      listFilter_active: false,
      listFilter_email: '%ann%',
      listFilter_ids: ids
    });
  });

  it('matches a scope array that is empty or holds the value', () => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, { region: 'eu' });

    const { where, params } = render(qb);
    expect(where).toBe(
      'item.tenant = :tenant AND (cardinality(item.regions) = 0 OR :listFilter_region = ANY(item.regions))'
    );
    expect(params['listFilter_region']).toBe('eu');
  });

  it.each([
    [{ hasOwner: true }, 'item.ownerId IS NOT NULL'],
    [{ hasOwner: false }, 'item.ownerId IS NULL'],
    [{ isExpired: true }, 'item.expiresAt > now()'],
    [
      { isExpired: false },
      '(item.expiresAt IS NULL OR item.expiresAt <= now())'
    ]
  ])('renders %p as %s', (query, condition) => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, query);

    expect(render(qb).where).toBe(`item.tenant = :tenant AND ${condition}`);
  });

  it('skips a filter that is not set, an empty text filter and an empty search', () => {
    const qb = builder();

    applyListQuery(qb, SPEC, COLUMNS, {
      q: '',
      active: undefined,
      email: ''
    });

    expect(render(qb).where).toBe('item.tenant = :tenant');
  });
});

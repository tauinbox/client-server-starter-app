import { BadRequestException } from '@nestjs/common';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { applyKeysetPagination } from './apply-keyset-pagination.util';
import { encodeCursor } from './cursor.util';

type MockQb = {
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
};

function createMockQueryBuilder(
  results: Record<string, unknown>[]
): MockQb & SelectQueryBuilder<ObjectLiteral> {
  const qb: MockQb = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(results)
  };
  return qb as MockQb & SelectQueryBuilder<ObjectLiteral>;
}

const sortColumnMap = {
  createdAt: 'user.createdAt',
  email: 'user.email'
};

const baseOptions = {
  limit: 2,
  sortBy: 'createdAt',
  sortOrder: 'desc' as const,
  sortColumnMap,
  idColumn: 'user.id'
};

describe('applyKeysetPagination', () => {
  it('should not add WHERE clause when no cursor is provided', async () => {
    const qb = createMockQueryBuilder([{ id: '1', createdAt: '2025-01-01' }]);

    await applyKeysetPagination(qb, baseOptions);

    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('user.id', 'DESC');
    expect(qb.take).toHaveBeenCalledWith(3);
  });

  it('should add < WHERE clause for DESC sort with cursor', async () => {
    const cursor = encodeCursor({ sortValue: '2025-01-01', id: 'id-5' });
    const qb = createMockQueryBuilder([]);

    await applyKeysetPagination(qb, { ...baseOptions, cursor });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(user.createdAt, user.id) < (:cursorSortValue, :cursorId)',
      { cursorSortValue: '2025-01-01', cursorId: 'id-5' }
    );
  });

  it('should add > WHERE clause for ASC sort with cursor', async () => {
    const cursor = encodeCursor({ sortValue: '2025-01-01', id: 'id-5' });
    const qb = createMockQueryBuilder([]);

    await applyKeysetPagination(qb, {
      ...baseOptions,
      sortOrder: 'asc',
      cursor
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(user.createdAt, user.id) > (:cursorSortValue, :cursorId)',
      { cursorSortValue: '2025-01-01', cursorId: 'id-5' }
    );
    expect(qb.orderBy).toHaveBeenCalledWith('user.createdAt', 'ASC');
  });

  it('should return hasMore=true and nextCursor when results exceed limit', async () => {
    const items = [
      { id: '3', createdAt: '2025-03-01' },
      { id: '2', createdAt: '2025-02-01' },
      { id: '1', createdAt: '2025-01-01' }
    ];
    const qb = createMockQueryBuilder(items);

    const result = await applyKeysetPagination(qb, baseOptions);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]['id']).toBe('3');
    expect(result.data[1]['id']).toBe('2');
    expect(result.nextCursor).not.toBeNull();
  });

  it('should return hasMore=false and null nextCursor when results fit in limit', async () => {
    const items = [{ id: '1', createdAt: '2025-01-01' }];
    const qb = createMockQueryBuilder(items);

    const result = await applyKeysetPagination(qb, baseOptions);

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('should return empty data and null nextCursor for no results', async () => {
    const qb = createMockQueryBuilder([]);

    const result = await applyKeysetPagination(qb, baseOptions);

    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it('should throw BadRequestException for invalid cursor', async () => {
    const qb = createMockQueryBuilder([]);

    await expect(
      applyKeysetPagination(qb, { ...baseOptions, cursor: 'bad-cursor' })
    ).rejects.toThrow(BadRequestException);
  });

  it('should fall back to first column when sortBy is not in map', async () => {
    const qb = createMockQueryBuilder([]);

    await applyKeysetPagination(qb, {
      ...baseOptions,
      sortBy: 'unknown'
    });

    expect(qb.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
  });
});

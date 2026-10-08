import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { MAX_LIST_FILTER_LENGTH } from '@app/shared/constants';
import {
  FeatureFlagCursorQueryDto,
  ResourceCursorQueryDto,
  RoleCursorQueryDto
} from './entity-cursor-query.dto';
import {
  InvoiceCursorQueryDto,
  SubscriptionCursorQueryDto
} from '../../modules/billing/dtos/billing-cursor-query.dto';
import { SearchUsersCursorQueryDto } from '../../modules/users/dtos/search-users-cursor-query.dto';

// The pipe options mirror main.ts. Every case goes through IntersectionType, so
// it also proves that the composition carries the generated metadata.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
});

async function validate(
  metatype: Type<unknown>,
  query: unknown
): Promise<Record<string, unknown>> {
  return (await pipe.transform(query, { type: 'query', metatype })) as Record<
    string,
    unknown
  >;
}

async function messages(
  metatype: Type<unknown>,
  query: unknown
): Promise<string[]> {
  const error = await validate(metatype, query).then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return ((error as BadRequestException).getResponse() as { message: string[] })
    .message;
}

describe('list query DTOs', () => {
  it.each([
    [FeatureFlagCursorQueryDto, { enabled: 'true', public: 'false' }],
    [RoleCursorQueryDto, { isSystem: 'false' }],
    [ResourceCursorQueryDto, { isSystem: 'true', isOrphaned: 'false' }]
  ])('%p accepts q and its own filters', async (metatype, filters) => {
    const result = await validate(metatype, { q: 'abc', ...filters });

    expect(result['q']).toBe('abc');
    for (const [key, raw] of Object.entries(filters)) {
      expect(result[key]).toBe(raw === 'true');
    }
  });

  it('keeps the pagination defaults beside the filters', async () => {
    const result = await validate(FeatureFlagCursorQueryDto, { q: 'abc' });

    expect(result).toMatchObject({
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });
  });

  it('reads an empty boolean filter as unset', async () => {
    const result = await validate(RoleCursorQueryDto, { isSystem: '' });

    expect(result['isSystem']).toBeUndefined();
  });

  it('rejects a filter of another list', async () => {
    await expect(
      messages(RoleCursorQueryDto, { enabled: 'true' })
    ).resolves.toEqual(['property enabled should not exist']);
  });

  it('reports the messages in the order the mock reproduces', async () => {
    await expect(
      messages(ResourceCursorQueryDto, {
        isOrphaned: 'maybe',
        q: ['a', 'b'],
        isSystem: 'yes'
      })
    ).resolves.toEqual([
      `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
      'q must be a string',
      'isSystem must be a boolean value',
      'isOrphaned must be a boolean value'
    ]);
  });

  it.each([
    SearchUsersCursorQueryDto,
    FeatureFlagCursorQueryDto,
    RoleCursorQueryDto,
    ResourceCursorQueryDto,
    InvoiceCursorQueryDto,
    SubscriptionCursorQueryDto
  ])(
    '%p reports the paging messages in the order the mock reproduces',
    async (metatype) => {
      const errors = await messages(metatype, {
        foo: '1',
        limit: '0',
        sortBy: 'zzz',
        sortOrder: 'up'
      });

      expect(errors).toHaveLength(4);
      expect(errors.slice(0, 2)).toEqual([
        'property foo should not exist',
        'limit must not be less than 1'
      ]);
      expect(errors[2]).toMatch(
        /^sortBy must be one of the following values: /
      );
      expect(errors[3]).toBe(
        'sortOrder must be one of the following values: asc, desc'
      );
    }
  );

  it('accepts a known environment and rejects any other value', async () => {
    await expect(
      validate(FeatureFlagCursorQueryDto, { environment: 'production' })
    ).resolves.toMatchObject({ environment: 'production' });
    await expect(
      messages(FeatureFlagCursorQueryDto, { environment: 'prod' })
    ).resolves.toEqual([
      'environment must be one of the following values: local, development, staging, production'
    ]);
  });

  it('limits sortBy to the sort columns of the definition', async () => {
    await expect(
      validate(RoleCursorQueryDto, { sortBy: 'name' })
    ).resolves.toMatchObject({ sortBy: 'name' });
    await expect(
      messages(RoleCursorQueryDto, { sortBy: 'key' })
    ).resolves.toEqual([
      'sortBy must be one of the following values: createdAt, name'
    ]);
  });

  it('has no q for a list with no search fields', async () => {
    await expect(messages(InvoiceCursorQueryDto, { q: 'x' })).resolves.toEqual([
      'property q should not exist'
    ]);
    await expect(
      validate(SubscriptionCursorQueryDto, { sortBy: 'currentPeriodEnd' })
    ).resolves.toMatchObject({ sortBy: 'currentPeriodEnd', limit: 20 });
  });

  it('caps q and accepts it at the cap', async () => {
    await expect(
      messages(FeatureFlagCursorQueryDto, {
        q: 'x'.repeat(MAX_LIST_FILTER_LENGTH + 1)
      })
    ).resolves.toEqual([
      `q must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`
    ]);
    await expect(
      validate(FeatureFlagCursorQueryDto, {
        q: 'x'.repeat(MAX_LIST_FILTER_LENGTH)
      })
    ).resolves.toMatchObject({ q: 'x'.repeat(MAX_LIST_FILTER_LENGTH) });
  });
});

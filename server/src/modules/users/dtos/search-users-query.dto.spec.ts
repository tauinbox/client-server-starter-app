import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { MAX_USER_FILTER_LENGTH } from '@app/shared/constants';
import { SearchUsersQueryDto } from './search-users-query.dto';
import { SearchUsersCursorQueryDto } from './search-users-cursor-query.dto';

// Both DTOs pull their filters from the same UserFiltersQueryDto through
// IntersectionType, so every case below is asserted against both to prove the
// composition actually carries the validation and transformation metadata.
const DTOS: [string, Type<object>][] = [
  ['SearchUsersQueryDto', SearchUsersQueryDto],
  ['SearchUsersCursorQueryDto', SearchUsersCursorQueryDto]
];

describe.each(DTOS)('%s filters', (_name, metatype) => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function validate(query: unknown): Promise<Record<string, unknown>> {
    return (await pipe.transform(query, {
      type: 'query',
      metatype
    })) as Record<string, unknown>;
  }

  async function expectMessage(query: unknown): Promise<string> {
    const error = await validate(query).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message.join(' ');
  }

  it('keeps the pagination defaults inherited through the intersection', async () => {
    const result = await validate({});

    expect(typeof result['limit']).toBe('number');
    expect(result['sortBy']).toBe('createdAt');
    expect(result['sortOrder']).toBe('desc');
  });

  it('accepts the string filters and the two boolean spellings', async () => {
    await expect(
      validate({
        q: 'ann',
        email: 'ann@example.com',
        firstName: 'Ann',
        lastName: 'Lee',
        role: 'admin',
        isActive: 'true',
        includeDeleted: 'false'
      })
    ).resolves.toMatchObject({
      q: 'ann',
      email: 'ann@example.com',
      firstName: 'Ann',
      lastName: 'Lee',
      role: 'admin',
      isActive: true,
      includeDeleted: false
    });
  });

  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'rejects a %s longer than the cap',
    async (field) => {
      const message = await expectMessage({
        [field]: 'x'.repeat(MAX_USER_FILTER_LENGTH + 1)
      });

      expect(message).toContain(
        `${field} must be shorter than or equal to ${MAX_USER_FILTER_LENGTH} characters`
      );
    }
  );

  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'accepts a %s exactly at the cap',
    async (field) => {
      await expect(
        validate({ [field]: 'x'.repeat(MAX_USER_FILTER_LENGTH) })
      ).resolves.toMatchObject({
        [field]: 'x'.repeat(MAX_USER_FILTER_LENGTH)
      });
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'rejects a non-boolean %s instead of dropping the filter',
    async (field) => {
      const message = await expectMessage({ [field]: 'maybe' });

      expect(message).toContain(`${field} must be a boolean value`);
    }
  );

  it.each(['isActive', 'includeDeleted'])(
    'reads an empty %s as unset',
    async (field) => {
      const result = await validate({ [field]: '' });

      expect(result[field]).toBeUndefined();
    }
  );

  it.each(['q', 'email', 'firstName', 'lastName', 'role'])(
    'rejects an array-valued %s',
    async (field) => {
      const message = await expectMessage({ [field]: ['a', 'b'] });

      expect(message).toContain(`${field} must be a string`);
    }
  );
});

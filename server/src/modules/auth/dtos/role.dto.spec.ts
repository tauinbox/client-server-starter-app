import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

// The pipe is the only layer that keeps the super and system flags out of a
// role write: RoleService takes no such fields. Pipe options mirror main.ts.
describe('role DTOs reject the super and system flags', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function rejection(
    body: object,
    metatype: typeof CreateRoleDto | typeof UpdateRoleDto
  ): Promise<unknown> {
    const error = await pipe.transform(body, { type: 'body', metatype }).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: unknown }
    ).message;
  }

  it.each([
    ['CreateRoleDto', CreateRoleDto, { name: 'escalated' }],
    ['UpdateRoleDto', UpdateRoleDto, {}]
  ])('%s rejects isSuper', async (_name, metatype, base) => {
    await expect(
      rejection({ ...base, isSuper: true }, metatype)
    ).resolves.toEqual(['property isSuper should not exist']);
  });

  it.each([
    ['CreateRoleDto', CreateRoleDto, { name: 'escalated' }],
    ['UpdateRoleDto', UpdateRoleDto, {}]
  ])('%s rejects isSystem', async (_name, metatype, base) => {
    await expect(
      rejection({ ...base, isSystem: true }, metatype)
    ).resolves.toEqual(['property isSystem should not exist']);
  });

  it('reports the unknown property before a field error', async () => {
    await expect(
      rejection({ name: '  ', isSuper: true }, CreateRoleDto)
    ).resolves.toEqual([
      'property isSuper should not exist',
      'name should not be empty'
    ]);
  });
});

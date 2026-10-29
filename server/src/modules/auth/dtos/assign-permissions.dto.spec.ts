import { UnprocessableEntityException } from '@nestjs/common';
import { ApiValidationPipe } from '../../../common/pipes/api-validation.pipe';
import {
  AssignPermissionsDto,
  SetPermissionsDto
} from './assign-permissions.dto';

// A repeated permission id would reach the insert and fail on the unique index
// of role_permissions with errors.db.uniqueViolation. The pipe refuses it as a
// body fault instead.
describe('permission DTOs refuse a repeated permission id', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_ID = '22222222-2222-4222-8222-222222222222';

  async function errors(
    metatype: typeof AssignPermissionsDto | typeof SetPermissionsDto,
    body: object
  ): Promise<unknown> {
    const error = await new ApiValidationPipe()
      .transform(body, { type: 'body', metatype })
      .then(
        () => null,
        (e: unknown) => e
      );
    if (error === null) return null;
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return (
      (error as UnprocessableEntityException).getResponse() as {
        message: unknown;
      }
    ).message;
  }

  it('AssignPermissionsDto refuses an id named twice', async () => {
    await expect(
      errors(AssignPermissionsDto, { permissionIds: [ID, ID] })
    ).resolves.toEqual(["All permissionIds's elements must be unique"]);
  });

  it('AssignPermissionsDto accepts two different ids', async () => {
    await expect(
      errors(AssignPermissionsDto, { permissionIds: [ID, OTHER_ID] })
    ).resolves.toBeNull();
  });

  it('SetPermissionsDto refuses a permission id named in two items', async () => {
    await expect(
      errors(SetPermissionsDto, {
        items: [
          { permissionId: ID, conditions: null },
          { permissionId: ID, conditions: { effect: 'deny' } }
        ]
      })
    ).resolves.toEqual(["All items's elements must be unique"]);
  });

  it('SetPermissionsDto accepts two items with different ids', async () => {
    await expect(
      errors(SetPermissionsDto, {
        items: [{ permissionId: ID }, { permissionId: OTHER_ID }]
      })
    ).resolves.toBeNull();
  });

  it('SetPermissionsDto reports only the item faults of two items with no id', async () => {
    await expect(
      errors(SetPermissionsDto, { items: [{}, {}] })
    ).resolves.toEqual([
      'items.0.permissionId must be a UUID',
      'items.1.permissionId must be a UUID'
    ]);
  });
});

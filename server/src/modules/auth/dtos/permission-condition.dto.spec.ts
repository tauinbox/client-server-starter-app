import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  AssignPermissionsDto,
  SetPermissionsDto
} from './assign-permissions.dto';

// Exercises the real request validation path: the same ValidationPipe options
// as main.ts, applied to the two DTOs that carry PermissionConditionDto
// (PUT and POST /roles/:id/permissions). A partially malformed condition must
// be rejected with 400 instead of silently registering a wider grant.
describe('PermissionConditionDto shape validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  const PERM_ID = '3f2b8c1e-4d5a-4f6b-8c7d-9e0f1a2b3c4d';

  async function validateSet(conditions: unknown): Promise<unknown> {
    return pipe.transform(
      { items: [{ permissionId: PERM_ID, conditions }] },
      { type: 'body', metatype: SetPermissionsDto }
    );
  }

  async function expectSetRejected(
    conditions: unknown,
    messagePart: string
  ): Promise<void> {
    const error = await validateSet(conditions).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    expect(response.message.join(' ')).toContain(messagePart);
  }

  describe('valid payloads', () => {
    it('accepts a null condition', async () => {
      await expect(validateSet(null)).resolves.toBeDefined();
    });

    it('accepts a fully valid condition', async () => {
      await expect(
        validateSet({
          effect: 'deny',
          ownership: { userField: 'createdBy' },
          fieldMatch: { status: ['active', 'pending'], count: [1, 2] },
          userAttr: { ownerId: 'id' },
          custom: '{"status":{"$in":["active"]}}'
        })
      ).resolves.toBeDefined();
    });
  });

  describe('fieldMatch', () => {
    it('rejects a non-array value mixed with a valid one (the silent-widening case)', async () => {
      await expectSetRejected(
        { fieldMatch: { status: ['active'], dept: 'sales' } },
        'fieldMatch.dept'
      );
    });

    it('rejects an empty array value', async () => {
      await expectSetRejected(
        { fieldMatch: { status: [] } },
        'non-empty array'
      );
    });

    it('rejects an empty object', async () => {
      await expectSetRejected({ fieldMatch: {} }, 'at least one field');
    });

    it('rejects non-scalar array elements', async () => {
      await expectSetRejected(
        { fieldMatch: { status: [{ nested: true }] } },
        'fieldMatch.status'
      );
    });

    it('rejects a non-object fieldMatch', async () => {
      await expectSetRejected({ fieldMatch: 5 }, 'fieldMatch');
    });
  });

  describe('ownership', () => {
    it('rejects an empty object', async () => {
      await expectSetRejected({ ownership: {} }, 'userField');
    });

    it('rejects a non-string userField', async () => {
      await expectSetRejected(
        { ownership: { userField: 5 } },
        'non-empty string'
      );
    });

    it('rejects an empty userField', async () => {
      await expectSetRejected(
        { ownership: { userField: '' } },
        'non-empty string'
      );
    });

    it('rejects extra keys next to userField', async () => {
      await expectSetRejected(
        { ownership: { userField: 'createdBy', extra: 1 } },
        'exactly one key'
      );
    });
  });

  describe('userAttr', () => {
    it('rejects a non-string attribute name', async () => {
      await expectSetRejected({ userAttr: { ownerId: 123 } }, 'userAttr');
    });

    it('rejects an empty attribute name', async () => {
      await expectSetRejected({ userAttr: { ownerId: '' } }, 'userAttr');
    });

    it('rejects an empty object', async () => {
      await expectSetRejected({ userAttr: {} }, 'at least one field');
    });
  });

  describe('unknown top-level keys', () => {
    it('rejects a condition with an undeclared property', async () => {
      await expectSetRejected({ unknownBranch: {} }, 'should not exist');
    });
  });

  describe('AssignPermissionsDto (POST variant)', () => {
    it('rejects the same malformed fieldMatch through the single-conditions field', async () => {
      const error = await pipe
        .transform(
          {
            permissionIds: [PERM_ID],
            conditions: { fieldMatch: { status: 'active' } }
          },
          { type: 'body', metatype: AssignPermissionsDto }
        )
        .then(
          () => null,
          (e: unknown) => e
        );

      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(response.message.join(' ')).toContain('fieldMatch.status');
    });

    it('accepts a valid conditions object', async () => {
      await expect(
        pipe.transform(
          {
            permissionIds: [PERM_ID],
            conditions: { fieldMatch: { status: ['active'] } }
          },
          { type: 'body', metatype: AssignPermissionsDto }
        )
      ).resolves.toBeDefined();
    });
  });
});

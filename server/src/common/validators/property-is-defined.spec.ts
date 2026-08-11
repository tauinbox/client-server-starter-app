import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { UpdateResourceDto } from '../../modules/auth/dtos/update-resource.dto';
import { UpdateActionDto } from '../../modules/auth/dtos/update-action.dto';
import { UpdateRoleDto } from '../../modules/auth/dtos/update-role.dto';
import { UpdateProfileDto } from '../../modules/auth/dtos/update-profile.dto';
import { CreateUserDto } from '../../modules/users/dtos/create-user.dto';
import { UpdateUserDto } from '../../modules/users/dtos/update-user.dto';
import { CreateFeatureFlagDto } from '../../modules/feature-flags/dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../../modules/feature-flags/dtos/update-feature-flag.dto';
import { PurchaseRequestDto } from '../../modules/billing/dtos/purchase-request.dto';
import { CancelSubscriptionRequestDto } from '../../modules/billing/dtos/cancel-subscription-request.dto';
import { RefundInvoiceRequestDto } from '../../modules/billing/dtos/refund-invoice-request.dto';
import { RecordUsageRequestDto } from '../../modules/billing/dtos/record-usage-request.dto';

// @IsOptional() skips validation for null as well as undefined, so an explicit
// null used to be forwarded to the entity: a NOT NULL violation surfacing as a
// 500, or - for UpdateUserDto/UpdateProfileDto.password, whose column is
// nullable - a silent credential wipe answered with 200.
describe('explicit null is rejected on optional fields backed by NOT NULL columns', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function validate(
    metatype: Type<unknown>,
    payload: unknown
  ): Promise<unknown> {
    return pipe.transform(payload, { type: 'body', metatype });
  }

  async function expectRejected(
    metatype: Type<unknown>,
    payload: unknown
  ): Promise<void> {
    await expect(validate(metatype, payload)).rejects.toBeInstanceOf(
      BadRequestException
    );
  }

  const VALID_USER = {
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: 'Password123'
  };

  describe('UpdateResourceDto', () => {
    it('rejects a null displayName', async () => {
      await expectRejected(UpdateResourceDto, { displayName: null });
    });

    it('still accepts an omitted displayName', async () => {
      await expect(validate(UpdateResourceDto, {})).resolves.toEqual({});
    });

    it('still accepts a whitespace-only displayName', async () => {
      await expect(
        validate(UpdateResourceDto, { displayName: '   ' })
      ).resolves.toEqual({ displayName: '   ' });
    });

    it('keeps accepting a null description, whose column is nullable', async () => {
      await expect(
        validate(UpdateResourceDto, { description: null })
      ).resolves.toEqual({ description: null });
    });
  });

  describe('UpdateActionDto', () => {
    it('rejects a null displayName', async () => {
      await expectRejected(UpdateActionDto, { displayName: null });
    });

    it('rejects a null description', async () => {
      await expectRejected(UpdateActionDto, { description: null });
    });

    it('still accepts an omitted field and an empty description', async () => {
      await expect(validate(UpdateActionDto, {})).resolves.toEqual({});
      await expect(
        validate(UpdateActionDto, { description: '' })
      ).resolves.toEqual({ description: '' });
    });
  });

  describe('UpdateRoleDto', () => {
    it('rejects a null name', async () => {
      await expectRejected(UpdateRoleDto, { name: null });
    });

    it('still accepts an omitted name and a valid one', async () => {
      await expect(validate(UpdateRoleDto, {})).resolves.toEqual({});
      await expect(
        validate(UpdateRoleDto, { name: 'editor' })
      ).resolves.toEqual({ name: 'editor' });
    });

    it('keeps accepting a null description, whose column is nullable', async () => {
      await expect(
        validate(UpdateRoleDto, { description: null })
      ).resolves.toEqual({ description: null });
    });
  });

  describe('UpdateProfileDto', () => {
    it.each(['firstName', 'lastName', 'locale'])(
      'rejects a null %s',
      async (field) => {
        await expectRejected(UpdateProfileDto, { [field]: null });
      }
    );

    // A null password passed validation, then skipped the controller's
    // verifyCurrentPassword branch: the column was nulled with a 200 and no
    // session invalidation. currentPassword is present because @ValidateIf
    // demands it whenever password is.
    it('rejects a null password sent with a currentPassword', async () => {
      await expectRejected(UpdateProfileDto, {
        password: null,
        currentPassword: 'Password1'
      });
    });

    it('still accepts a partial update', async () => {
      await expect(
        validate(UpdateProfileDto, { firstName: 'Jane' })
      ).resolves.toEqual({ firstName: 'Jane' });
    });
  });

  describe('CreateUserDto', () => {
    it('rejects a null locale', async () => {
      await expectRejected(CreateUserDto, { ...VALID_USER, locale: null });
    });

    it('still accepts an omitted locale', async () => {
      await expect(validate(CreateUserDto, VALID_USER)).resolves.toEqual(
        VALID_USER
      );
    });
  });

  describe('UpdateUserDto', () => {
    it.each([
      'email',
      'firstName',
      'lastName',
      'password',
      'locale',
      'isActive',
      'unlockAccount'
    ])('rejects a null %s', async (field) => {
      await expectRejected(UpdateUserDto, { [field]: null });
    });

    it('still accepts a partial update', async () => {
      await expect(
        validate(UpdateUserDto, { isActive: false })
      ).resolves.toEqual({ isActive: false });
    });

    it('documents the inherited fields in Swagger', () => {
      const metadata = Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        UpdateUserDto.prototype
      ) as string[] | undefined;

      expect(metadata).toEqual(
        expect.arrayContaining([
          ':email',
          ':firstName',
          ':lastName',
          ':password',
          ':locale'
        ])
      );
    });
  });

  describe('feature flag DTOs', () => {
    it.each(['enabled', 'environments', 'public'])(
      'rejects a null %s on create',
      async (field) => {
        await expectRejected(CreateFeatureFlagDto, {
          key: 'new-dashboard',
          [field]: null
        });
      }
    );

    it.each(['key', 'enabled', 'environments', 'public'])(
      'rejects a null %s on update',
      async (field) => {
        await expectRejected(UpdateFeatureFlagDto, { [field]: null });
      }
    );

    it('still accepts an omitted field and a null description', async () => {
      await expect(validate(UpdateFeatureFlagDto, {})).resolves.toEqual({});
      await expect(
        validate(UpdateFeatureFlagDto, { description: null })
      ).resolves.toEqual({ description: null });
    });
  });

  // The billing DTOs post-date the sweep above. A null amountMinor used to pass
  // validation, skip the "amount omitted" guard (=== undefined) and then compare
  // as 0 against the bounds, so a custom product with a zero lower bound charged
  // - and receipted - the provider a null amount.
  describe('billing DTOs', () => {
    it('rejects a null amountMinor on a purchase', async () => {
      await expectRejected(PurchaseRequestDto, {
        productKey: 'donation',
        amountMinor: null
      });
    });

    it('still accepts an omitted and a valid amountMinor', async () => {
      await expect(
        validate(PurchaseRequestDto, { productKey: 'donation' })
      ).resolves.toEqual({ productKey: 'donation' });
      await expect(
        validate(PurchaseRequestDto, {
          productKey: 'donation',
          amountMinor: 500
        })
      ).resolves.toEqual({ productKey: 'donation', amountMinor: 500 });
    });

    it('rejects a null cancel mode instead of passing it to the provider', async () => {
      await expectRejected(CancelSubscriptionRequestDto, { mode: null });
    });

    it('still accepts an omitted and a valid cancel mode', async () => {
      await expect(validate(CancelSubscriptionRequestDto, {})).resolves.toEqual(
        {}
      );
      await expect(
        validate(CancelSubscriptionRequestDto, { mode: 'immediate' })
      ).resolves.toEqual({ mode: 'immediate' });
    });

    // The remaining optional billing fields default a null the same way they
    // default an omitted property, so @IsOptional() stays correct for them.
    it('keeps accepting a null on the fields whose consumer defaults it', async () => {
      await expect(
        validate(RefundInvoiceRequestDto, { amountMinor: null })
      ).resolves.toEqual({ amountMinor: null });
      await expect(
        validate(PurchaseRequestDto, {
          productKey: 'donation',
          description: null
        })
      ).resolves.toEqual({ productKey: 'donation', description: null });
      await expect(
        validate(RecordUsageRequestDto, {
          customerId: '123e4567-e89b-12d3-a456-426614174000',
          meterKey: 'api_calls',
          quantity: 1,
          idempotencyKey: 'evt-1',
          occurredAt: null
        })
      ).resolves.toMatchObject({ occurredAt: null });
    });
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Authorize } from './authorize.decorator';
import {
  PERMISSIONS_KEY,
  RequirePermissions
} from './require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import type { PermissionCheck } from '../casl/app-ability';

@Authorize(['read', 'User'])
class DecoratedController {}

describe('Authorize decorator', () => {
  it('should set the required permissions metadata', () => {
    const checks = new Reflector().get<PermissionCheck[]>(
      PERMISSIONS_KEY,
      DecoratedController
    );

    expect(checks).toEqual([['read', 'User']]);
  });

  it('should apply PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DecoratedController
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
  });

  it('should not accept a call without checks', () => {
    // @ts-expect-error - at least one permission check is required
    expect(() => Authorize()).not.toThrow();
  });

  it('should not accept RequirePermissions without checks', () => {
    // @ts-expect-error - at least one permission check is required
    expect(() => RequirePermissions()).not.toThrow();
  });
});

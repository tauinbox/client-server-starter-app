import { ForbiddenException } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import { assertCan } from './assert-can.util';
import type { AppAbility } from '../../modules/auth/casl/app-ability';
import { bindAuditContext } from '../../modules/auth/casl/ability-context';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants';
import { thrownBy } from '../testing/thrown-by';

describe('assertCan', () => {
  let auditService: { logFireAndForget: jest.Mock };
  let metricsService: { recordPermissionDenied: jest.Mock };

  beforeEach(() => {
    auditService = { logFireAndForget: jest.fn() };
    metricsService = { recordPermissionDenied: jest.fn() };
  });

  it('should not throw when ability allows the action', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };

    expect(() =>
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'update',
        { id: '1' },
        auditService,
        { targetId: '1', targetType: 'User' },
        metricsService
      )
    ).not.toThrow();
    expect(auditService.logFireAndForget).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when ability denies the action', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    expect(() =>
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'delete',
        { id: '2' },
        auditService,
        { targetId: '2', targetType: 'User' },
        metricsService
      )
    ).toThrow(ForbiddenException);
  });

  it('carries an errorKey, so the client can translate the refusal', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    expect(
      thrownBy(() =>
        assertCan(
          // @ts-expect-error partial mock
          ability,
          'delete',
          { id: '2' },
          auditService,
          { targetId: '2', targetType: 'User' },
          metricsService
        )
      )
    ).toMatchObject({
      response: {
        message: 'Insufficient permissions',
        errorKey: ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
      }
    });
  });

  it('should fire audit log with instance check details on denial', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    try {
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'update',
        { id: '3' },
        auditService,
        { actorId: 'actor-1', targetId: '3', targetType: 'User' },
        metricsService
      );
    } catch {
      // expected
    }

    expect(auditService.logFireAndForget).toHaveBeenCalledWith({
      action: AuditAction.PERMISSION_CHECK_FAILURE,
      actorId: 'actor-1',
      targetId: '3',
      targetType: 'User',
      details: {
        instanceCheck: true,
        deniedAction: 'update',
        subject: 'Object'
      }
    });
  });

  it('should use constructor name as subject for entity instances', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    class User {
      id = '4';
    }
    const user = new User();

    try {
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'delete',
        user,
        auditService,
        { targetId: '4', targetType: 'User' },
        metricsService
      );
    } catch {
      // expected
    }

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          subject: 'User'
        }) as Record<string, unknown>
      })
    );
  });

  it('records rbac_permission_denied_total with level=instance', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    class User {
      id = '5';
    }
    const user = new User();

    try {
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'update',
        user,
        auditService,
        { actorId: 'actor-1', targetId: '5', targetType: 'User' },
        metricsService
      );
    } catch {
      // expected
    }

    expect(metricsService.recordPermissionDenied).toHaveBeenCalledWith(
      'instance',
      'update',
      'User'
    );
  });

  it('uses CASL __caslSubjectType__ brand as audit subject when present', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    class FooEntity {
      id = '7';
    }
    const branded = subject('User', new FooEntity());

    try {
      assertCan(
        // @ts-expect-error partial mock
        ability,
        'update',
        branded,
        auditService,
        { actorId: 'actor-1', targetId: '7', targetType: 'User' },
        metricsService
      );
    } catch {
      // expected
    }

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          subject: 'User'
        }) as Record<string, unknown>
      })
    );
    expect(metricsService.recordPermissionDenied).toHaveBeenCalledWith(
      'instance',
      'update',
      'User'
    );
  });

  it('writes the request context that the guard bound to the ability', () => {
    const ability = new AbilityBuilder<AppAbility>(createMongoAbility).build();
    bindAuditContext(ability, { ip: '203.0.113.7', requestId: 'req-1' });

    thrownBy(() =>
      assertCan(
        ability,
        'update',
        subject('User', { id: '8' }),
        // @ts-expect-error partial mock
        auditService,
        { actorId: 'actor-1', targetId: '8', targetType: 'User' },
        metricsService
      )
    );

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { ip: '203.0.113.7', requestId: 'req-1' }
      })
    );
  });

  it('does not touch metrics on allow path', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };

    assertCan(
      // @ts-expect-error partial mock
      ability,
      'update',
      { id: '6' },
      auditService,
      { targetId: '6', targetType: 'User' },
      metricsService
    );

    expect(metricsService.recordPermissionDenied).not.toHaveBeenCalled();
  });
});

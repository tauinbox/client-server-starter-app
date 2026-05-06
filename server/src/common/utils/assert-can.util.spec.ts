import { ForbiddenException } from '@nestjs/common';
import { subject } from '@casl/ability';
import { assertCan } from './assert-can.util';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

describe('assertCan', () => {
  let auditService: { logFireAndForget: jest.Mock };

  beforeEach(() => {
    auditService = { logFireAndForget: jest.fn() };
  });

  it('should not throw when ability allows the action', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };

    expect(() =>
      // @ts-expect-error partial mock
      assertCan(ability, 'update', { id: '1' }, auditService, {
        targetId: '1',
        targetType: 'User'
      })
    ).not.toThrow();
    expect(auditService.logFireAndForget).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when ability denies the action', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    expect(() =>
      // @ts-expect-error partial mock
      assertCan(ability, 'delete', { id: '2' }, auditService, {
        targetId: '2',
        targetType: 'User'
      })
    ).toThrow(ForbiddenException);
  });

  it('should fire audit log with instance check details on denial', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    try {
      // @ts-expect-error partial mock
      assertCan(ability, 'update', { id: '3' }, auditService, {
        actorId: 'actor-1',
        targetId: '3',
        targetType: 'User'
      });
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
      // @ts-expect-error partial mock
      assertCan(ability, 'delete', user, auditService, {
        targetId: '4',
        targetType: 'User'
      });
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

  it('records rbac_permission_denied_total with level=instance when metricsService passed', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };
    const metricsService = { recordPermissionDenied: jest.fn() };

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
    const metricsService = { recordPermissionDenied: jest.fn() };

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

  it('does not touch metrics on allow path', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };
    const metricsService = { recordPermissionDenied: jest.fn() };

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

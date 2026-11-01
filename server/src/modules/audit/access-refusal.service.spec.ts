import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import { AccessRefusalService } from './access-refusal.service';
import type { AppAbility } from '../auth/casl/app-ability';
import { bindAuditContext } from '../auth/casl/ability-context';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants';
import { thrownBy } from '../../common/testing/thrown-by';
import { expectApiError } from '../../common/testing/api-error.expect';

describe('AccessRefusalService.assertCan', () => {
  let auditService: { logFireAndForget: jest.Mock };
  let metricsService: { recordPermissionDenied: jest.Mock };
  let refusals: AccessRefusalService;

  beforeEach(() => {
    auditService = { logFireAndForget: jest.fn() };
    metricsService = { recordPermissionDenied: jest.fn() };
    refusals = new AccessRefusalService(
      // @ts-expect-error partial mock
      auditService,
      metricsService
    );
  });

  it('should not throw when ability allows the action', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };

    expect(() =>
      refusals.assertCan(
        // @ts-expect-error partial mock
        ability,
        {
          action: 'update',
          subject: { id: '1' },
          targetId: '1',
          targetType: 'User'
        }
      )
    ).not.toThrow();
    expect(auditService.logFireAndForget).not.toHaveBeenCalled();
  });

  it('refuses with INSUFFICIENT_PERMISSIONS when ability denies the action', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    expectApiError(
      thrownBy(() =>
        refusals.assertCan(
          // @ts-expect-error partial mock
          ability,
          {
            action: 'delete',
            subject: { id: '2' },
            targetId: '2',
            targetType: 'User'
          }
        )
      ),
      ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
    );
  });

  it('carries an errorKey, so the client can translate the refusal', () => {
    const ability = { can: jest.fn().mockReturnValue(false) };

    expect(
      thrownBy(() =>
        refusals.assertCan(
          // @ts-expect-error partial mock
          ability,
          {
            action: 'delete',
            subject: { id: '2' },
            targetId: '2',
            targetType: 'User'
          }
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
      refusals.assertCan(
        // @ts-expect-error partial mock
        ability,
        {
          action: 'update',
          subject: { id: '3' },
          actorId: 'actor-1',
          targetId: '3',
          targetType: 'User'
        }
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
      refusals.assertCan(
        // @ts-expect-error partial mock
        ability,
        { action: 'delete', subject: user, targetId: '4', targetType: 'User' }
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
      refusals.assertCan(
        // @ts-expect-error partial mock
        ability,
        {
          action: 'update',
          subject: user,
          actorId: 'actor-1',
          targetId: '5',
          targetType: 'User'
        }
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
      refusals.assertCan(
        // @ts-expect-error partial mock
        ability,
        {
          action: 'update',
          subject: branded,
          actorId: 'actor-1',
          targetId: '7',
          targetType: 'User'
        }
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
      refusals.assertCan(ability, {
        action: 'update',
        subject: subject('User', { id: '8' }),
        actorId: 'actor-1',
        targetId: '8',
        targetType: 'User'
      })
    );

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { ip: '203.0.113.7', requestId: 'req-1' }
      })
    );
  });

  it('does not touch metrics on allow path', () => {
    const ability = { can: jest.fn().mockReturnValue(true) };

    refusals.assertCan(
      // @ts-expect-error partial mock
      ability,
      {
        action: 'update',
        subject: { id: '6' },
        targetId: '6',
        targetType: 'User'
      }
    );

    expect(metricsService.recordPermissionDenied).not.toHaveBeenCalled();
  });
});

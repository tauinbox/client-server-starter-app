import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_MFA_ENROLMENT_GATE_KEY } from '../decorators/skip-mfa-enrolment-gate.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { MfaRequiredGuard } from './mfa-required.guard';
import { createMockExecutionContext } from '../../../common/testing/execution-context.mock';

describe('MfaRequiredGuard', () => {
  let mfaPolicy: { mustEnrol: jest.Mock };
  let auditService: { logFireAndForget: jest.Mock };
  let metricsService: { recordPermissionDenied: jest.Mock };
  let reflector: Reflector;
  let guard: MfaRequiredGuard;

  beforeEach(() => {
    mfaPolicy = { mustEnrol: jest.fn() };
    auditService = { logFireAndForget: jest.fn() };
    metricsService = { recordPermissionDenied: jest.fn() };
    reflector = new Reflector();
    guard = new MfaRequiredGuard(
      reflector,
      // @ts-expect-error testing mock
      mfaPolicy,
      auditService,
      metricsService
    );
  });

  it('admits an account that owes no enrolment', async () => {
    mfaPolicy.mustEnrol.mockResolvedValue(false);
    const context = createMockExecutionContext({
      request: { user: { userId: 'user-1' } }
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mfaPolicy.mustEnrol).toHaveBeenCalledWith('user-1');
  });

  it('refuses an account that owes an enrolment, and names the reason', async () => {
    mfaPolicy.mustEnrol.mockResolvedValue(true);
    const context = createMockExecutionContext({
      request: { user: { userId: 'user-1' } }
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { errorKey: ErrorKeys.AUTH.MFA_ENROLMENT_REQUIRED }
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException
    );
  });

  it('audits and counts the refusal with the request context', async () => {
    mfaPolicy.mustEnrol.mockResolvedValue(true);
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === PERMISSIONS_KEY ? [['read', 'Role']] : undefined
      );
    const context = createMockExecutionContext({
      request: {
        user: { userId: 'user-1' },
        ip: '203.0.113.7',
        requestId: 'req-1'
      }
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403
    });

    expect(auditService.logFireAndForget).toHaveBeenCalledWith({
      action: AuditAction.PERMISSION_CHECK_FAILURE,
      actorId: 'user-1',
      targetId: null,
      targetType: null,
      details: { required: ['read:Role'], mfaEnrolmentRequired: true },
      context: { ip: '203.0.113.7', requestId: 'req-1' }
    });
    expect(metricsService.recordPermissionDenied).toHaveBeenCalledWith(
      'guard',
      'read',
      'Role'
    );
  });

  it('leaves a route marked with the skip decorator open', async () => {
    mfaPolicy.mustEnrol.mockResolvedValue(true);
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === SKIP_MFA_ENROLMENT_GATE_KEY ? true : undefined
      );
    const context = createMockExecutionContext({
      request: { user: { userId: 'user-1' } }
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mfaPolicy.mustEnrol).not.toHaveBeenCalled();
  });

  it('refuses a request that carries no authenticated user', async () => {
    const context = createMockExecutionContext({ request: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(mfaPolicy.mustEnrol).not.toHaveBeenCalled();
  });
});

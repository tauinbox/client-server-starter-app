import { Reflector } from '@nestjs/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, of, lastValueFrom, throwError } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditService } from '../audit.service';
import { LogAuditOptions } from '../decorators/log-audit.decorator';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined
    }),
    getHandler: () => ({}),
    getClass: () => ({})
  } as unknown as ExecutionContext;
}

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let reflector: { get: jest.Mock };
  let auditService: { logFireAndForget: jest.Mock; log: jest.Mock };

  beforeEach(() => {
    reflector = { get: jest.fn() };
    auditService = {
      logFireAndForget: jest.fn(),
      log: jest.fn().mockResolvedValue(undefined)
    };
    interceptor = new AuditLogInterceptor(
      reflector as unknown as Reflector,
      auditService as unknown as AuditService
    );
  });

  it('passes through unchanged when no @LogAudit metadata', async () => {
    reflector.get.mockReturnValue(undefined);
    const ctx = makeContext({
      user: { userId: 'u1' },
      params: {},
      headers: {}
    });
    const next: CallHandler = { handle: () => of('result') };

    const result = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(result).toBe('result');
    expect(auditService.logFireAndForget).not.toHaveBeenCalled();
  });

  it('logs with targetId from default :id route param after success', async () => {
    const opts: LogAuditOptions = {
      action: AuditAction.ROLE_DELETE,
      targetType: 'Role'
    };
    reflector.get.mockReturnValue(opts);
    const ctx = makeContext({
      user: { userId: 'admin-1', email: 'a@e.com' },
      params: { id: 'role-42' },
      headers: { 'x-request-id': 'req-1' },
      ip: '10.0.0.1'
    });
    const next: CallHandler = { handle: () => of(undefined) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(auditService.logFireAndForget).toHaveBeenCalledWith({
      action: AuditAction.ROLE_DELETE,
      actorId: 'admin-1',
      actorEmail: 'a@e.com',
      targetId: 'role-42',
      targetType: 'Role',
      details: null,
      context: { ip: '10.0.0.1', requestId: 'req-1' }
    });
  });

  it('uses custom targetIdParam when provided', async () => {
    const opts: LogAuditOptions = {
      action: AuditAction.ROLE_ASSIGN,
      targetType: 'User',
      targetIdParam: 'userId'
    };
    reflector.get.mockReturnValue(opts);
    const ctx = makeContext({
      user: { userId: 'admin-1', email: 'a@e.com' },
      params: { userId: 'u-99' },
      headers: {}
    });
    const next: CallHandler = { handle: () => of(undefined) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'u-99' })
    );
  });

  it('extracts targetId from response body when targetIdFromResponse is set', async () => {
    const opts: LogAuditOptions = {
      action: AuditAction.ROLE_CREATE,
      targetType: 'Role',
      targetIdFromResponse: (r) => (r as { id: string }).id
    };
    reflector.get.mockReturnValue(opts);
    const ctx = makeContext({
      user: { userId: 'admin-1', email: 'a@e.com' },
      params: {},
      headers: {}
    });
    const next: CallHandler = {
      handle: () => of({ id: 'role-new', name: 'editor' })
    };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'role-new' })
    );
  });

  it('builds details from the details() callback', async () => {
    const opts: LogAuditOptions = {
      action: AuditAction.ROLE_UPDATE,
      targetType: 'Role',
      details: ({ body }) => ({
        changedFields: Object.keys(body as Record<string, unknown>)
      })
    };
    reflector.get.mockReturnValue(opts);
    const ctx = makeContext({
      user: { userId: 'admin-1', email: 'a@e.com' },
      params: { id: 'role-1' },
      body: { name: 'x', description: 'y' },
      headers: {}
    });
    const next: CallHandler = { handle: () => of({ id: 'role-1' }) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { changedFields: ['name', 'description'] }
      })
    );
  });

  it('does not log when handler throws', async () => {
    const opts: LogAuditOptions = {
      action: AuditAction.ROLE_DELETE,
      targetType: 'Role'
    };
    reflector.get.mockReturnValue(opts);
    const ctx = makeContext({
      user: { userId: 'admin-1' },
      params: { id: 'role-1' },
      headers: {}
    });
    const next: CallHandler = {
      handle: (): Observable<unknown> => throwError(() => new Error('boom'))
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, next))
    ).rejects.toThrow('boom');
    expect(auditService.logFireAndForget).not.toHaveBeenCalled();
  });
});

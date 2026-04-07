import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AuditService } from '../audit.service';
import {
  LOG_AUDIT_KEY,
  LogAuditOptions
} from '../decorators/log-audit.decorator';
import { extractAuditContext } from '../../../common/utils/audit-context.util';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string; email?: string };
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<LogAuditOptions | undefined>(
      LOG_AUDIT_KEY,
      context.getHandler()
    );

    if (!opts) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return next.handle().pipe(
      tap((response) => {
        const params = (req.params ?? {}) as Record<string, string>;
        const targetId = opts.targetIdFromResponse
          ? (opts.targetIdFromResponse(response) ?? null)
          : (params[opts.targetIdParam ?? 'id'] ?? null);

        const details = opts.details
          ? opts.details({
              request: req,
              response,
              params,
              body: req.body
            })
          : undefined;

        this.auditService.logFireAndForget({
          action: opts.action,
          actorId: req.user?.userId ?? null,
          actorEmail: req.user?.email ?? null,
          targetId,
          targetType: opts.targetType,
          details: details ?? null,
          context: extractAuditContext(req)
        });
      })
    );
  }
}

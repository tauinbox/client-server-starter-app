import * as crypto from 'crypto';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const candidate = typeof incoming === 'string' ? incoming : '';
    const requestId = REQUEST_ID_PATTERN.test(candidate)
      ? candidate
      : crypto.randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}

import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.originalUrl === '/api/v1/health') {
      next();
      return;
    }

    const start = Date.now();
    const logLevel = (process.env['REQUEST_LOG_LEVEL'] || 'all').toLowerCase();

    res.on('finish', () => {
      const statusCode = res.statusCode;

      if (logLevel === 'error' && statusCode < 500) return;
      if (logLevel === 'warn' && statusCode < 400) return;

      const duration = Date.now() - start;
      const requestId = res.getHeader('X-Request-Id') as string | undefined;
      const message = `${req.method} ${req.originalUrl} ${statusCode} ${duration}ms${requestId ? ` [req-id: ${requestId}]` : ''}`;

      if (statusCode >= 500) {
        this.logger.error(message);
      } else if (statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}

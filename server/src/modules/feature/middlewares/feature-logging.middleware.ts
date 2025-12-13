import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class FeatureLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(FeatureLoggingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    this.logger.log(
      `${req.method} ${req.url} | Content-Type: ${req.headers['content-type']} | Accept: ${req.headers['accept']}`
    );
    next();
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction } from 'express';

@Injectable()
export class FeatureLoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): any {
    console.log(
      `[FeatureLoggingMiddleware] ${new Date().toISOString()} - ${req.method} ${req.url}, Content-Type: ${req.headers['content-type']}, Accept: ${req.headers['accept']}`
    );

    next();
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): any {
    console.log(
      `[${new Date().toISOString()}]} - LoggerMiddleware event triggered - ${req.method} ${req.url}, Content-Type: ${req.headers['content-type']}`,
    );

    next();
  }
}

import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

// An API answer can hold personal data, so no browser or shared cache may keep
// a copy. The SSE stream replaces the header with its own in writeHead, and a
// route that needs another policy sets it with @Header.
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
}

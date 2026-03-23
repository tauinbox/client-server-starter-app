import {
  CorsOptions,
  CorsOptionsDelegate
} from '@nestjs/common/interfaces/external/cors-options.interface';
import { Request } from 'express';

export const corsOptions = (): CorsOptions | CorsOptionsDelegate<Request> => {
  const originsString = process.env['CORS_ORIGINS'];
  if (originsString) {
    if (originsString === '*') {
      if (process.env['ENVIRONMENT'] === 'production') {
        throw new Error('CORS_ORIGINS=* is not allowed in production');
      }
      return {
        origin: '*',
        credentials: false,
        preflightContinue: false,
        optionsSuccessStatus: 204
      };
    }
    return {
      origin: originsString.split(','),
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }
  if (process.env['ENVIRONMENT'] === 'local') {
    return {
      origin: ['http://localhost:4200', 'http://localhost:3000'],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }

  return { origin: false };
};

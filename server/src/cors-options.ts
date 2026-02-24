import {
  CorsOptions,
  CorsOptionsDelegate
} from '@nestjs/common/interfaces/external/cors-options.interface';
import { Request } from 'express';

export const corsOptions = (): CorsOptions | CorsOptionsDelegate<Request> => {
  const originsString = process.env['CORS_ORIGINS'];
  if (originsString) {
    return {
      origin: originsString === '*' ? '*' : originsString.split('#'),
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }
  if (process.env['ENVIRONMENT'] === 'local') {
    return {
      origin: ['http://localhost:4200', 'http://localhost:3000'],
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }

  return { origin: false };
};

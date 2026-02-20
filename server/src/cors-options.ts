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
  return {
    origin: process.env['ENVIRONMENT'] === 'local'
  };
};

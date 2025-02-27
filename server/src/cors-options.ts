import {
  CorsOptions,
  CorsOptionsDelegate
} from "@nestjs/common/interfaces/external/cors-options.interface";

export const corsOptions = (): CorsOptions | CorsOptionsDelegate<any> => {
  const originsString = process.env.CORS_ORIGINS;
  if (originsString) {
    return {
      origin: originsString === "*" ? "*" : originsString.split("#"),
      preflightContinue: false,
      optionsSuccessStatus: 204
    };
  }
  return {
    origin: process.env.ENVIRONMENT === "local"
  };
};

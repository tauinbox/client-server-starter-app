import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { ConfigService } from '@nestjs/config';

/** Injection token for the lazily-constructed Paddle SDK client (or `null`). */
export const PADDLE_CLIENT = Symbol('PADDLE_CLIENT');

/**
 * Builds the Paddle SDK client from env, or `null` when Paddle is not
 * configured (no API key) — the provider then reports billing unavailable
 * instead of constructing a client that would fail on first call. The sandbox
 * environment is selected unless `PADDLE_ENVIRONMENT=production`.
 */
export function createPaddleClient(config: ConfigService): Paddle | null {
  const apiKey = config.get<string>('PADDLE_API_KEY');
  if (!apiKey) {
    return null;
  }
  const environment =
    config.get<string>('PADDLE_ENVIRONMENT') === 'production'
      ? Environment.production
      : Environment.sandbox;
  return new Paddle(apiKey, { environment });
}

import { YooCheckout } from '@a2seven/yoo-checkout';
import { ConfigService } from '@nestjs/config';

/** Injection token for the lazily-constructed YooKassa SDK client (or `null`). */
export const YOOKASSA_CLIENT = Symbol('YOOKASSA_CLIENT');

/**
 * Builds the YooKassa SDK client from env, or `null` when YooKassa is not
 * configured (shop id / secret key absent) — the provider then reports billing
 * unavailable instead of constructing a client that would fail on first call.
 * Both credentials are required. Unlike `BillingConfigService.isConfigured`,
 * `REDIS_URL` is not: an existing subscription must still cancel and refund
 * when new YooKassa checkouts are disabled for lack of Redis.
 */
export function createYooKassaClient(
  config: ConfigService
): YooCheckout | null {
  const shopId = config.get<string>('YOOKASSA_SHOP_ID');
  const secretKey = config.get<string>('YOOKASSA_SECRET_KEY');
  if (!shopId || !secretKey) {
    return null;
  }
  return new YooCheckout({ shopId, secretKey });
}

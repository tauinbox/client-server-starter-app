import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CheckoutSession,
  ChargeResult,
  NormalizedEvent,
  PaymentProvider
} from './payment-provider.interface';

/**
 * YooKassa (Russia, 54-FZ). Self-managed lifecycle — the core drives renewals
 * and dunning. Stub for M0 — real first-payment/off-session/webhook land in M1.
 */
@Injectable()
export class YooKassaProvider implements PaymentProvider {
  readonly id = 'yookassa' as const;
  readonly managesLifecycle = false;

  ensureCustomer(): Promise<string> {
    throw new NotImplementedException('YooKassaProvider.ensureCustomer (M1)');
  }

  startCheckout(): Promise<CheckoutSession> {
    throw new NotImplementedException('YooKassaProvider.startCheckout (M1)');
  }

  chargeOffSession(): Promise<ChargeResult> {
    throw new NotImplementedException('YooKassaProvider.chargeOffSession (M1)');
  }

  cancel(): Promise<void> {
    throw new NotImplementedException('YooKassaProvider.cancel (M1)');
  }

  refund(): Promise<void> {
    throw new NotImplementedException('YooKassaProvider.refund (M1)');
  }

  verifyAndParseWebhook(): Promise<NormalizedEvent | null> {
    return Promise.resolve(null);
  }
}

import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CheckoutSession,
  ChargeResult,
  NormalizedEvent,
  PaymentProvider
} from './payment-provider.interface';

/**
 * Paddle (Merchant-of-Record, rest-of-world). Provider-managed lifecycle.
 * Stub for M0 — real checkout/webhook/cancel/refund land in M1.
 */
@Injectable()
export class PaddleProvider implements PaymentProvider {
  readonly id = 'paddle' as const;
  readonly managesLifecycle = true;

  ensureCustomer(): Promise<string> {
    throw new NotImplementedException('PaddleProvider.ensureCustomer (M1)');
  }

  startCheckout(): Promise<CheckoutSession> {
    throw new NotImplementedException('PaddleProvider.startCheckout (M1)');
  }

  chargeOffSession(): Promise<ChargeResult> {
    throw new NotImplementedException('PaddleProvider.chargeOffSession (M1)');
  }

  cancel(): Promise<void> {
    throw new NotImplementedException('PaddleProvider.cancel (M1)');
  }

  refund(): Promise<void> {
    throw new NotImplementedException('PaddleProvider.refund (M1)');
  }

  verifyAndParseWebhook(): Promise<NormalizedEvent | null> {
    return Promise.resolve(null);
  }
}

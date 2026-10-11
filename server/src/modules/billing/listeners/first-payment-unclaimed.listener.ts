import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FirstPaymentUnclaimedEvent } from '../events/billing.events';
import { BillingAdminService } from '../services/billing-admin.service';

/**
 * Gives back in full a first payment that activated nothing. A failure is
 * logged and the invoice stays `paid`, so an administrator can refund it.
 */
@Injectable()
export class FirstPaymentUnclaimedListener {
  private readonly logger = new Logger(FirstPaymentUnclaimedListener.name);

  constructor(private readonly billingAdmin: BillingAdminService) {}

  @OnEvent(FirstPaymentUnclaimedEvent.name)
  async handle(event: FirstPaymentUnclaimedEvent): Promise<void> {
    try {
      await this.billingAdmin.refundInvoice(event.invoiceId);
      this.logger.warn(
        `Invoice ${event.invoiceId} of user ${event.userId} activated no subscription and was refunded`
      );
    } catch (err) {
      this.logger.error(
        `Failed to refund unclaimed first-payment invoice ${event.invoiceId} of user ${event.userId}`,
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}

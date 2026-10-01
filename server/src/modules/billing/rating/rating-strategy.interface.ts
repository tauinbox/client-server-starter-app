import type { ReceiptItem } from '../providers/payment-provider.interface';

export interface BillingPeriod {
  start: Date;
  end: Date;
}

export interface RatedAmount {
  amountMinor: number;
  /** The currency of the plan price, never of the customer. */
  currency: string;
  receiptItems: ReceiptItem[];
}

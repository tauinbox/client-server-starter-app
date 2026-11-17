import type { ReceiptItem } from '../providers/payment-provider.interface';

export interface RatedAmount {
  amountMinor: number;
  /** The currency of the plan price, never of the customer. */
  currency: string;
  receiptItems: ReceiptItem[];
}

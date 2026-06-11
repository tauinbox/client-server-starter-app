/**
 * Hand-off between starting a one-time purchase and the checkout return page.
 * The provider redirect comes back to /billing/success with no way to carry
 * state, so the session reference (the provider payment id the paid invoice
 * is keyed by — `providerInvoiceRef`) is parked in sessionStorage before the
 * redirect and picked up by the return page to poll for the settled invoice.
 */
export type PendingPurchase = {
  sessionRef: string;
  productName: string;
  amountMinor: number;
  currency: string;
};

const STORAGE_KEY = 'nxs.billing.pending-purchase';

export function storePendingPurchase(purchase: PendingPurchase): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(purchase));
  } catch {
    // Storage unavailable (private mode/quota): the return page falls back to
    // the subscription-style pending message; the invoice still lands.
  }
}

export function readPendingPurchase(): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPurchase>;
    if (typeof parsed.sessionRef !== 'string' || !parsed.sessionRef) {
      return null;
    }
    return {
      sessionRef: parsed.sessionRef,
      productName:
        typeof parsed.productName === 'string' ? parsed.productName : '',
      amountMinor:
        typeof parsed.amountMinor === 'number' ? parsed.amountMinor : 0,
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'USD'
    };
  } catch {
    return null;
  }
}

export function clearPendingPurchase(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean if storage is unavailable.
  }
}

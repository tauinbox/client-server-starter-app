// Helpers of the HTML pages that the mock serves itself (the hosted checkout
// and the billing lab).

export function escapeHtml(value: string): string {
  return value.replaceAll(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ] ?? char
  );
}

export function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    amountMinor / 100
  );
}

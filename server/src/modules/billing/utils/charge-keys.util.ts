/**
 * The `provider_event_id` an off-session charge is recorded under. The key is
 * derived from ids the caller cannot choose and is stable across retries, so a
 * replay reconciles onto the same invoice instead of charging twice, and the
 * confirming webhook carries it back through the provider's metadata.
 */
export const CHANGE_CHARGE_KEY_PREFIX = 'change-charge:';
export const CHANGE_REFUND_KEY_PREFIX = 'change-refund:';

/** The charge leg of a self-managed plan switch. */
export function changeChargeKey(
  subscriptionId: string,
  planKey: string,
  periodEndMs: number
): string {
  return `${CHANGE_CHARGE_KEY_PREFIX}${subscriptionId}:${planKey}:${periodEndMs}`;
}

/** The refund leg of a self-managed plan switch. */
export function changeRefundKey(
  subscriptionId: string,
  planKey: string,
  periodEndMs: number
): string {
  return `${CHANGE_REFUND_KEY_PREFIX}${subscriptionId}:${planKey}:${periodEndMs}`;
}

/**
 * Whether the flow behind `chargeKey` records its invoice row BEFORE asking the
 * provider for the money. Only such a flow can read "the confirming webhook
 * matched no invoice" as an anomaly worth alerting on: the renewal and
 * closing-cancel charges (`renewal:`, `cancel:`) record once the provider has
 * answered or thrown, so a webhook that wins that race routinely finds nothing
 * and the local path inserts moments later.
 */
export function isPlantedBeforeCharge(chargeKey: string): boolean {
  return chargeKey.startsWith(CHANGE_CHARGE_KEY_PREFIX);
}

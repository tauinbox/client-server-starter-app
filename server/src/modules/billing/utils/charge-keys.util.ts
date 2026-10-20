/**
 * The `provider_event_id` an off-session charge is recorded under. The key is
 * derived from ids the caller cannot choose and is stable across retries, so a
 * replay reconciles onto the same invoice instead of charging twice, and the
 * confirming webhook carries it back through the provider's metadata.
 */
export const CHANGE_CHARGE_KEY_PREFIX = 'change-charge:';
export const CHANGE_REFUND_KEY_PREFIX = 'change-refund:';

/**
 * The charge leg of a self-managed plan switch. `seq` is the count of switches
 * committed before this one, so a switch back to a plan used earlier in the
 * period gets a new key. The amount depends on the target plan, so a retry to
 * another plan gets a new key too.
 */
export function changeChargeKey(
  subscriptionId: string,
  seq: number,
  planKey: string
): string {
  return `${changeChargeKeyPrefix(subscriptionId, seq)}${planKey}`;
}

/** The part of `changeChargeKey` that every target plan of one switch shares. */
export function changeChargeKeyPrefix(
  subscriptionId: string,
  seq: number
): string {
  return `${CHANGE_CHARGE_KEY_PREFIX}${subscriptionId}:${seq}:`;
}

/**
 * The refund leg of a self-managed plan switch. The amount depends only on the
 * outgoing plan, so a retry to another target reuses the leg of the attempt
 * that did not commit.
 */
export function changeRefundKey(subscriptionId: string, seq: number): string {
  return `${CHANGE_REFUND_KEY_PREFIX}${subscriptionId}:${seq}`;
}

export const RENEWAL_CHARGE_KEY_PREFIX = 'renewal:';
export const CLOSING_CHARGE_KEY_PREFIX = 'cancel:';

/**
 * Whether the flow behind `chargeKey` records its invoice row BEFORE asking the
 * provider for the money. Only such a flow can read "the confirming webhook
 * matched no invoice" as an anomaly worth alerting on. The plan-change charge,
 * the renewal charge and the closing charge all record first: their row holds
 * the credit units the amount assumes before the money moves.
 */
export function isPlantedBeforeCharge(chargeKey: string): boolean {
  return [
    CHANGE_CHARGE_KEY_PREFIX,
    RENEWAL_CHARGE_KEY_PREFIX,
    CLOSING_CHARGE_KEY_PREFIX
  ].some((prefix) => chargeKey.startsWith(prefix));
}

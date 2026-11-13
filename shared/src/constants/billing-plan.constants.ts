/**
 * Key of the default tier. A customer with no entitled subscription gets its
 * entitlements. It is not a purchasable plan: checkout and plan change refuse
 * it, and a subscriber returns to it through a cancel.
 */
export const FREE_PLAN_KEY = 'free';

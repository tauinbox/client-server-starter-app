/**
 * Key of the default tier. A customer with no entitled subscription gets its
 * entitlements. It is not a purchasable plan: checkout and plan change refuse
 * it, and a subscriber returns to it through a cancel.
 */
export const FREE_PLAN_KEY = 'free';

/**
 * Key of the pay-as-you-go tier. A customer with no entitled subscription and a
 * positive credit balance gets its entitlements. It is not a purchasable plan:
 * checkout and plan change refuse it, and a buyer starts it with a credit pack.
 */
export const PAY_AS_YOU_GO_PLAN_KEY = 'usage';

import {
  INVOICE_LIST_QUERY,
  SUBSCRIPTION_LIST_QUERY
} from '@app/shared/constants';
import type { ListColumns } from '../../../common/utils/apply-list-query.util';

/** The columns of the billing lists, for `applyList`. */
export const INVOICE_LIST_COLUMNS: ListColumns<typeof INVOICE_LIST_QUERY> = {
  search: {},
  filters: {},
  sort: { createdAt: 'invoice.createdAt', status: 'invoice.status' },
  id: 'invoice.id'
};

export const SUBSCRIPTION_LIST_COLUMNS: ListColumns<
  typeof SUBSCRIPTION_LIST_QUERY
> = {
  search: {},
  filters: {},
  sort: {
    createdAt: 'subscription.createdAt',
    currentPeriodEnd: 'subscription.currentPeriodEnd',
    status: 'subscription.status'
  },
  id: 'subscription.id'
};

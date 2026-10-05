import {
  INVOICE_LIST_QUERY,
  SUBSCRIPTION_LIST_QUERY
} from '@app/shared/constants';
import { ListCursorQueryDto } from '../../../common/dtos';

export class InvoiceCursorQueryDto extends ListCursorQueryDto(
  INVOICE_LIST_QUERY
) {}

export class SubscriptionCursorQueryDto extends ListCursorQueryDto(
  SUBSCRIPTION_LIST_QUERY
) {}

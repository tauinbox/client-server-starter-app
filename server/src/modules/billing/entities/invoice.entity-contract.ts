import type { Invoice } from './invoice.entity';
import type { InvoiceResponse, _AssertNever } from '@app/shared/types';

/**
 * Provider event id used for webhook idempotency and the cumulative refunded
 * amount used for partial-refund accounting — both @Exclude()-d from the wire.
 */
type _ExcludedFields = 'providerEventId' | 'refundedMinor';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Invoice, keyof InvoiceResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof InvoiceResponse, keyof Invoice>
>;

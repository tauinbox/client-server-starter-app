import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';

/**
 * Inserts an invoice unless a row with the same unique `providerEventId`
 * exists. Returns the new row id, or `null` when the key was already taken,
 * which is the signal every caller uses to run its side effects exactly once.
 */
export async function insertInvoiceOnce(
  manager: EntityManager,
  values: QueryDeepPartialEntity<Invoice>
): Promise<string | null> {
  const insert = await manager
    .createQueryBuilder()
    .insert()
    .into(Invoice)
    .values(values)
    .orIgnore()
    .returning(['id'])
    .execute();
  const rows = insert.raw as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

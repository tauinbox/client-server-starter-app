import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';

/**
 * Provider webhook idempotency / audit ledger. Internal only — never serialised
 * to a client, so it has no response DTO, entity-contract, or shared wire type.
 * The unique (provider, provider_event_id) constraint makes webhook replays a
 * no-op once a delivery has been `processed`; a row that is still `received`
 * marks an unfinished delivery the next redelivery (or the reconciliation sweep)
 * reprocesses.
 */
@Entity('billing_webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  provider: BillingProviderId;

  @Column({ name: 'provider_event_id', type: 'varchar' })
  providerEventId: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'payload_hash', type: 'varchar' })
  payloadHash: string;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  /**
   * The verified, provider-agnostic `NormalizedEvent`, kept so the
   * reconciliation sweep can replay a stuck `received` delivery without the
   * provider (Paddle cannot re-fetch by id). Typed `object` (not
   * `NormalizedEvent`) so TypeORM's insert builder does not recurse into the
   * event's `unknown` payload; read back through a `NormalizedEvent` assertion.
   * Null only on rows written before this column existed.
   */
  @Column({ type: 'jsonb', nullable: true })
  payload: object | null;

  @CreateDateColumn({ name: 'received_at' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt: Date | null;
}

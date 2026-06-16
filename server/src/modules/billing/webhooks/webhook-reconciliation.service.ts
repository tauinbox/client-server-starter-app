import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import type { NormalizedEvent } from '../providers/payment-provider.interface';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS } from './billing-webhook-queue.constants';

/**
 * Recovers webhook deliveries the queued path could otherwise lose: once the
 * provider has been acked (200) the reduce runs on BullMQ, and if it exhausts
 * its retries the event would sit in `received` forever with no redelivery to
 * rescue it. This sweep replays every row stuck in `received` past the
 * threshold from its persisted event, so a transient outage self-heals instead
 * of dropping an `invoice.paid` / `subscription.canceled`.
 *
 * Replaying is safe to repeat: the reduce is idempotent and `processEvent`
 * flips the row to `processed` on success, so a row that genuinely succeeds
 * leaves the sweep; one that keeps failing is retried each tick (and logged for
 * operator visibility) rather than churning the queue.
 */
@Injectable()
export class WebhookReconciliationService {
  private readonly logger = new Logger(WebhookReconciliationService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly ingestion: WebhookIngestionService
  ) {}

  /** Replays deliveries stuck in `received` longer than the stuck threshold. */
  async sweep(now: Date = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS
    );
    const stuck = await this.webhookEvents.find({
      where: { status: 'received', receivedAt: LessThan(cutoff) }
    });
    if (stuck.length === 0) {
      return;
    }

    this.logger.warn(`Replaying ${stuck.length} stuck webhook delivery(ies)`);
    for (const row of stuck) {
      if (!row.payload) {
        // Pre-migration rows never stored the event and cannot be replayed
        // without the provider; leave them for manual handling.
        this.logger.error(
          `Cannot replay webhook ${row.id} (${row.provider} ${row.providerEventId}): no stored payload`
        );
        continue;
      }
      try {
        await this.ingestion.processEvent({
          webhookEventId: row.id,
          event: row.payload as NormalizedEvent
        });
      } catch (error) {
        this.logger.error(
          `Replay failed for webhook ${row.id} (${row.provider} ${row.providerEventId})`,
          error as Error
        );
      }
    }
  }
}

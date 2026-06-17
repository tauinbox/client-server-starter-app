import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import type { NormalizedEvent } from '../providers/payment-provider.interface';
import { WebhookIngestionService } from './webhook-ingestion.service';
import {
  WEBHOOK_MAX_REPLAY_ATTEMPTS,
  WEBHOOK_RECEIVED_STUCK_THRESHOLD_MS
} from './billing-webhook-queue.constants';

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
 * leaves the sweep. A delivery that keeps failing is bounded: after
 * `WEBHOOK_MAX_REPLAY_ATTEMPTS` failed replays it is moved to `dead_letter`
 * (one alert on the transition) so the sweep stops hammering it and the error
 * log stops repeating every tick. It is never dropped — the row keeps its
 * `payload` and is replayable via the admin endpoint or a provider redelivery.
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
        await this.recordFailure(row, error);
      }
    }
  }

  /**
   * Persists a failed replay: bumps `attempts`/`last_error` and, once the
   * delivery has failed `WEBHOOK_MAX_REPLAY_ATTEMPTS` times, quarantines it as
   * `dead_letter` (which the sweep query then excludes) with a single alert on
   * the transition instead of an error every tick.
   */
  private async recordFailure(
    row: WebhookEvent,
    error: unknown
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    const quarantined = attempts >= WEBHOOK_MAX_REPLAY_ATTEMPTS;

    await this.webhookEvents.update(
      { id: row.id },
      quarantined
        ? { attempts, lastError, status: 'dead_letter' }
        : { attempts, lastError }
    );

    if (quarantined) {
      this.logger.warn(
        `Quarantined webhook ${row.id} (${row.provider} ${row.providerEventId}) ` +
          `after ${attempts} failed replays; status -> dead_letter. Last error: ${lastError}`
      );
    } else {
      this.logger.error(
        `Replay failed for webhook ${row.id} (${row.provider} ${row.providerEventId}) ` +
          `[attempt ${attempts}/${WEBHOOK_MAX_REPLAY_ATTEMPTS}]`,
        error as Error
      );
    }
  }
}

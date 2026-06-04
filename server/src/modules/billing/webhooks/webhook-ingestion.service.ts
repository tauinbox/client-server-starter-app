import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { Repository } from 'typeorm';
import type { BillingProviderId } from '@app/shared/types';
import { WebhookEvent } from '../entities/webhook-event.entity';
import {
  BILLING_PROVIDERS,
  type PaymentProvider
} from '../providers/payment-provider.interface';
import { BillingEventReducer } from './billing-event-reducer.service';
import {
  BILLING_WEBHOOK_QUEUE,
  BILLING_WEBHOOK_REDUCE_JOB,
  type BillingWebhookJobData
} from './billing-webhook-queue.constants';

/**
 * Ingests provider webhooks: verify authenticity via the provider seam, persist
 * an idempotency row (unique (provider, provider_event_id) — replays no-op),
 * then hand off to reduction. When Redis is configured the reduction runs on
 * BullMQ so the HTTP ack stays within the provider's timeout; without Redis it
 * runs inline, mirroring MailService's optional-queue fallback. The reducer
 * itself lands in M1 — processEvent is the seam.
 */
@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    @Inject(BILLING_PROVIDERS)
    private readonly providers: PaymentProvider[],
    private readonly reducer: BillingEventReducer,
    @Optional()
    @InjectQueue(BILLING_WEBHOOK_QUEUE)
    private readonly queue?: Queue<BillingWebhookJobData>
  ) {}

  async ingest(
    providerId: BillingProviderId,
    rawBody: Buffer | undefined,
    headers: IncomingHttpHeaders
  ): Promise<void> {
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing webhook body');
    }

    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) {
      throw new BadRequestException('Unknown billing provider');
    }

    const event = await provider.verifyAndParseWebhook(rawBody, headers);
    if (!event) {
      // Signature invalid / unverifiable, or an event type we ignore.
      throw new BadRequestException('Webhook verification failed');
    }

    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const result = await this.webhookEvents
      .createQueryBuilder()
      .insert()
      .values({
        provider: providerId,
        providerEventId: event.providerEventId,
        type: event.type,
        payloadHash,
        status: 'received',
        processedAt: null
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    const inserted = result.raw as Array<{ id: string }>;
    if (inserted.length === 0) {
      // Duplicate (provider, provider_event_id) — replay, already handled.
      this.logger.debug(
        `Duplicate ${providerId} webhook ${event.providerEventId} ignored`
      );
      return;
    }

    await this.dispatch({ webhookEventId: inserted[0].id, event });
  }

  private async dispatch(data: BillingWebhookJobData): Promise<void> {
    if (this.queue) {
      await this.queue.add(BILLING_WEBHOOK_REDUCE_JOB, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100
      });
      return;
    }
    await this.processEvent(data);
  }

  /**
   * Applies a verified event: reduces it onto Subscription/Invoice in a
   * transaction, then marks the ledger row processed. Public so the BullMQ
   * processor can call it; errors propagate (the row stays `received`) so the
   * worker — or the next delivery — retries.
   */
  async processEvent(data: BillingWebhookJobData): Promise<void> {
    await this.reducer.reduce(data.event);
    await this.webhookEvents.update(
      { id: data.webhookEventId },
      { status: 'processed', processedAt: new Date() }
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../entities/webhook-event.entity';
import {
  DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS,
  DEFAULT_WEBHOOK_RETENTION_DAYS,
  WEBHOOK_RETENTION_BATCH_SIZE,
  WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP
} from './billing-webhook-queue.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bounds the webhook ledger, which otherwise only ever grows: every verified
 * delivery is persisted with its normalized event and nothing removes it.
 *
 * Two windows, both measured from `received_at` (the delivery's age - always
 * present, unlike `processed_at` on rows written before that column existed):
 * the payload is nulled out at the shorter one and the row itself is deleted at
 * the longer one. Only `processed` rows are eligible. A `received` row is an
 * unfinished delivery the reconciliation sweep still replays from its payload,
 * and a `dead_letter` row is quarantined evidence an admin can requeue - both
 * keep their payload and their row for as long as they are in that state.
 *
 * Work is batched and capped per sweep so the first run against a ledger that
 * has never been pruned cannot hold a single long transaction over the table.
 */
@Injectable()
export class WebhookRetentionService {
  private readonly logger = new Logger(WebhookRetentionService.name);
  private readonly retentionMs: number;
  private readonly payloadRetentionMs: number;

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    config: ConfigService
  ) {
    this.retentionMs =
      Number(
        config.get<string>('BILLING_WEBHOOK_RETENTION_DAYS') ??
          DEFAULT_WEBHOOK_RETENTION_DAYS
      ) * DAY_MS;
    this.payloadRetentionMs =
      Number(
        config.get<string>('BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS') ??
          DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS
      ) * DAY_MS;
  }

  /** Redacts, then prunes, settled deliveries past their window. */
  async sweep(now: Date = new Date()): Promise<void> {
    const redacted = await this.dropPayloads(
      new Date(now.getTime() - this.payloadRetentionMs)
    );
    const deleted = await this.deleteExpired(
      new Date(now.getTime() - this.retentionMs)
    );

    if (redacted > 0 || deleted > 0) {
      this.logger.log(
        `Webhook ledger retention: ${redacted} payload(s) dropped, ${deleted} row(s) deleted`
      );
    }
  }

  /**
   * Nulls the payload of settled deliveries older than the payload window. The
   * `payload IS NOT NULL` filter keeps an already-redacted row out of every
   * later sweep, so the batch loop terminates instead of rewriting the same rows.
   */
  private dropPayloads(cutoff: Date): Promise<number> {
    return this.inBatches((limit) =>
      this.webhookEvents
        .createQueryBuilder()
        .update()
        .set({ payload: null })
        .where(`id IN (${this.eligibleIds('payload IS NOT NULL')})`, {
          cutoff,
          limit
        })
        .execute()
        .then((result) => result.affected ?? 0)
    );
  }

  /** Deletes settled deliveries older than the retention window. */
  private deleteExpired(cutoff: Date): Promise<number> {
    return this.inBatches((limit) =>
      this.webhookEvents
        .createQueryBuilder()
        .delete()
        .where(`id IN (${this.eligibleIds()})`, { cutoff, limit })
        .execute()
        .then((result) => result.affected ?? 0)
    );
  }

  /**
   * Sub-select of the next batch of settled deliveries past `cutoff`. A DELETE /
   * UPDATE cannot carry a LIMIT of its own in Postgres, so the bound is applied
   * to the id set the statement matches on.
   */
  private eligibleIds(extraCondition?: string): string {
    const conditions = [
      `status = 'processed'`,
      'received_at < :cutoff',
      ...(extraCondition ? [extraCondition] : [])
    ];
    return (
      `SELECT id FROM ${this.webhookEvents.metadata.tableName} ` +
      `WHERE ${conditions.join(' AND ')} LIMIT :limit`
    );
  }

  /**
   * Runs `statement` until it stops filling a batch or the per-sweep ceiling is
   * reached, so a large backlog is worked off over several sweeps rather than in
   * one statement that holds locks for minutes.
   */
  private async inBatches(
    statement: (limit: number) => Promise<number>
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const limit = Math.min(
        WEBHOOK_RETENTION_BATCH_SIZE,
        WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP - total
      );
      if (limit <= 0) {
        this.logger.warn(
          `Webhook ledger retention hit its per-sweep ceiling (${WEBHOOK_RETENTION_MAX_ROWS_PER_SWEEP} rows); the rest is left for the next sweep`
        );
        return total;
      }

      const affected = await statement(limit);
      total += affected;
      if (affected < limit) {
        return total;
      }
    }
  }
}

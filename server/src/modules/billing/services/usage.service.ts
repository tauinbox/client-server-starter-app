import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { UsageRecord } from '../entities/usage-record.entity';

const PG_UNIQUE_VIOLATION = '23505';

// A usage record only counts toward a subscription that is currently billable;
// `canceled`/`incomplete` subscriptions cannot accrue metered usage.
const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

export interface RecordUsageInput {
  customerId: string;
  meterKey: string;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: Date;
}

/**
 * Metering ingest (design §3, §5). Records raw usage events against a customer's
 * active subscription; aggregation/rating happens later (UsageRating, BKL-076).
 *
 * Ingest is idempotent on `idempotencyKey` (unique column): a replay of the same
 * key returns the original record without inserting a duplicate, so an at-least-
 * once producer (retrying webhook/queue) never double-counts. There is no public
 * meter endpoint — the only HTTP surface is the `manage Billing`-gated admin
 * route; this service is also called in-process by usage producers.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecords: Repository<UsageRecord>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>
  ) {}

  async record(input: RecordUsageInput): Promise<UsageRecord> {
    const existing = await this.usageRecords.findOne({
      where: { idempotencyKey: input.idempotencyKey }
    });
    if (existing) {
      return existing;
    }

    const subscription = await this.subscriptions.findOne({
      where: {
        customerId: input.customerId,
        status: In([...ACTIVE_STATUSES])
      }
    });
    if (!subscription) {
      throw new NotFoundException(
        'No active subscription for customer to record usage against'
      );
    }

    const record = this.usageRecords.create({
      customerId: input.customerId,
      subscriptionId: subscription.id,
      meterKey: input.meterKey,
      quantity: input.quantity,
      occurredAt: input.occurredAt ?? new Date(),
      idempotencyKey: input.idempotencyKey
    });

    try {
      return await this.usageRecords.save(record);
    } catch (error: unknown) {
      // Lost an insert race on the same idempotency key — the unique constraint
      // rejected the second writer. Return the record the winner persisted so the
      // call stays idempotent rather than surfacing a 500.
      const code = (error as { code?: string }).code;
      if (code === PG_UNIQUE_VIOLATION) {
        const winner = await this.usageRecords.findOne({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (winner) {
          this.logger.debug(
            `Idempotent usage replay on key ${input.idempotencyKey}`
          );
          return winner;
        }
      }
      throw error;
    }
  }
}

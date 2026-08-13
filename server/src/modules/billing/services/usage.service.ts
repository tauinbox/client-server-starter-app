import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@app/shared/constants';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditService } from './credit.service';

export interface RecordUsageInput {
  customerId: string;
  meterKey: string;
  quantity: number;
  idempotencyKey: string;
  /** ISO 8601 string (HTTP ingest) or Date (in-process producers). Now if omitted. */
  occurredAt?: Date | string;
}

/**
 * Metering ingest. Records raw usage events against a customer's
 * active subscription; aggregation/rating happens later in UsageRating.
 *
 * Ingest is idempotent on `(customerId, idempotencyKey)` (unique constraint): a
 * replay of the same key returns the original record without inserting a
 * duplicate, so an at-least-once producer (retrying webhook/queue) never
 * double-counts. The key is scoped to the customer because producers namespace
 * their sequences per tenant, and a shared key across customers would otherwise
 * discard the second customer's event. There is no public
 * meter endpoint — the only HTTP surface is the `manage Billing`-gated admin
 * route; this service is also called in-process by usage producers.
 *
 * A record is an observation about a customer, not an accounting fact: it is
 * stored whatever plan is in force, and `UsageRating` decides at period close
 * whether the plan prices that meter. Gating the write on the plan would make an
 * immutable fact conditional on state that changes under it — an upgrade an hour
 * into the period would have discarded the hour before it. The only rejection
 * here is a meter no plan in the catalog declares, which cannot become
 * chargeable later and is a producer typo.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecords: Repository<UsageRecord>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
    private readonly credits: CreditService,
    private readonly metrics: MetricsService
  ) {}

  async record(input: RecordUsageInput): Promise<UsageRecord> {
    const existing = await this.usageRecords.findOne({
      where: {
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey
      }
    });
    if (existing) {
      return this.stampPricing(existing);
    }

    // A negative balance means a refund clawed back already-spent credits:
    // no new usage may accrue until the debt is topped up.
    if (await this.credits.isBlocked(input.customerId)) {
      throw new ConflictException(
        'Credit balance is negative. Top up credits before recording more usage.'
      );
    }

    const subscription = await this.findActiveSubscription(input.customerId);
    if (!subscription) {
      throw new NotFoundException(
        'No active subscription for customer to record usage against'
      );
    }

    // One query answers both questions: is this meter in the catalog at all, and
    // is it the meter the customer's current plan prices.
    const candidates = await this.plans.find({
      where: [{ key: subscription.planKey }, { meterKey: input.meterKey }]
    });
    if (!candidates.some((p) => p.meterKey === input.meterKey)) {
      throw new BadRequestException(
        `Meter "${input.meterKey}" is not declared by any plan`
      );
    }

    const record = this.usageRecords.create({
      customerId: input.customerId,
      subscriptionId: subscription.id,
      meterKey: input.meterKey,
      quantity: Money.fromMinor(input.quantity),
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      idempotencyKey: input.idempotencyKey
    });

    let saved: UsageRecord;
    try {
      saved = await this.usageRecords.save(record);
    } catch (error: unknown) {
      // Lost an insert race on the same idempotency key — the unique constraint
      // rejected the second writer. Return the record the winner persisted so the
      // call stays idempotent rather than surfacing a 500.
      if (isUniqueViolation(error)) {
        const winner = await this.usageRecords.findOne({
          where: {
            customerId: input.customerId,
            idempotencyKey: input.idempotencyKey
          }
        });
        if (winner) {
          this.logger.debug(
            `Idempotent usage replay on key ${input.idempotencyKey}`
          );
          return this.stampPricing(winner);
        }
      }
      throw error;
    }

    const ownPlan = candidates.find((p) => p.key === subscription.planKey);
    saved.pricedByCurrentPlan = ownPlan?.meterKey === input.meterKey;

    // Stored but not chargeable under the plan in force. Visible rather than
    // fatal: a producer meters what it observes and cannot know the customer's
    // plan, so this is an operations signal, not the producer's error.
    if (!saved.pricedByCurrentPlan) {
      this.logger.warn(
        `Usage under meter "${input.meterKey}" is not priced by plan "${subscription.planKey}" (customer ${input.customerId})`
      );
      this.metrics.recordUnratedUsage(input.meterKey);
    }

    return saved;
  }

  /**
   * Newest-first, matching the entitlement resolver, so usage is billed to the
   * subscription whose entitlements the customer is actually using. Two active
   * rows only arise from an admin action or a webhook race, never from
   * self-service subscribing.
   */
  private findActiveSubscription(
    customerId: string
  ): Promise<Subscription | null> {
    // A usage record only counts toward a subscription that is currently
    // billable; `canceled`/`incomplete` ones cannot accrue metered usage.
    return this.subscriptions.findOne({
      where: { customerId, status: In([...ENTITLED_SUBSCRIPTION_STATUSES]) },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Answers the pricing verdict for a record the caller did not just build, so
   * a replay reports the plan in force now rather than the one that applied
   * when the row was first written.
   */
  private async stampPricing(record: UsageRecord): Promise<UsageRecord> {
    const subscription = await this.findActiveSubscription(record.customerId);
    const plan = subscription
      ? await this.plans.findOne({ where: { key: subscription.planKey } })
      : null;
    record.pricedByCurrentPlan = plan?.meterKey === record.meterKey;
    return record;
  }
}

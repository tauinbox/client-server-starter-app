import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import { Customer } from '../entities/customer.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { RenewalUpcomingEvent } from '../events/billing.events';
import { FixedRating } from '../rating/fixed-rating.strategy';
import {
  RENEWAL_NOTICE_LEAD_MS,
  RENEWAL_SCAN_MAX_PER_RUN
} from './renewal-queue.constants';

/** The boundary that the next charge falls on, as `renewalAnchor` gives it. */
const RENEWAL_BOUNDARY = `(CASE WHEN subscriptions.status = 'trialing' AND subscriptions.trial_end IS NOT NULL THEN subscriptions.trial_end ELSE subscriptions.current_period_end END)`;

/**
 * A self-managed row that renews inside the lead and has no notice for that
 * boundary yet. A row with `cancel_at_period_end` does not renew, a `past_due`
 * row already gets the dunning notices, and a soft-deleted user is never
 * charged. Provider-managed (Paddle) rows are left out: the provider sends
 * its own renewal mail.
 */
const NOTICE_DUE = [
  `subscriptions.lifecycle_owner = 'self'`,
  `subscriptions.status IN ('active', 'trialing')`,
  'subscriptions.cancel_at_period_end = false',
  `${RENEWAL_BOUNDARY} > :now`,
  `${RENEWAL_BOUNDARY} <= :horizon`,
  `subscriptions.renewal_notice_for IS DISTINCT FROM ${RENEWAL_BOUNDARY}`,
  `EXISTS (SELECT 1 FROM billing_customers c INNER JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL WHERE c.id = subscriptions.customer_id)`
].join(' AND ');

/**
 * Tells the user of a self-managed subscription that the saved card will be
 * charged soon. Each scan claims the due rows with one guarded update that
 * writes the boundary into `renewal_notice_for`, and emits a notice only for
 * the rows that it claimed. A second scan in the same period, a parallel scan
 * on another instance and a scan after a crash claim nothing, so a period gets
 * at most one notice. A claim that the process does not follow with the event
 * (a crash between the two) loses that notice; it never sends two.
 */
@Injectable()
export class RenewalNoticeService {
  private readonly logger = new Logger(RenewalNoticeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Plan, SETTINGS_DATA_SOURCE)
    private readonly plans: Repository<Plan>,
    private readonly fixedRating: FixedRating,
    private readonly events: EventEmitter2
  ) {}

  async sendRenewalNotices(now: Date = new Date()): Promise<void> {
    const claimed = await this.claimDueNotices(now);

    for (const id of claimed) {
      try {
        await this.notify(id);
      } catch (error) {
        this.logger.error(
          `Renewal notice failed for subscription ${id}`,
          error as Error
        );
      }
    }
  }

  /**
   * The condition is in the outer statement too, because PostgreSQL checks it
   * again on the locked row: a scan that waited on the row of a parallel scan
   * then sees the marker and skips it.
   */
  private async claimDueNotices(now: Date): Promise<string[]> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(Subscription)
      .set({ renewalNoticeFor: () => RENEWAL_BOUNDARY })
      .where(
        `id IN (SELECT subscriptions.id FROM subscriptions WHERE ${NOTICE_DUE} ORDER BY ${RENEWAL_BOUNDARY} LIMIT :limit)`
      )
      .andWhere(NOTICE_DUE)
      .setParameters({
        now,
        horizon: new Date(now.getTime() + RENEWAL_NOTICE_LEAD_MS),
        limit: RENEWAL_SCAN_MAX_PER_RUN
      })
      .returning('id')
      .execute();

    const ids = (result.raw as Array<{ id: string }>).map(({ id }) => id);

    if (ids.length === RENEWAL_SCAN_MAX_PER_RUN) {
      this.logger.warn(
        `Renewal notice scan hit its per-run ceiling (${RENEWAL_SCAN_MAX_PER_RUN} subscriptions); the rest are left for the next scan`
      );
    }

    return ids;
  }

  private async notify(id: string): Promise<void> {
    const subscription = await this.subscriptions.findOne({ where: { id } });

    if (!subscription?.renewalNoticeFor) return;

    const customer = await this.customers.findOne({
      where: { id: subscription.customerId }
    });
    const plan = await this.plans.findOne({
      where: { key: subscription.planKey }
    });

    if (!customer || !plan) return;

    // The amount that the renewal charge prices the period at.
    const { amountMinor, currency } = this.fixedRating.amountForPeriod(
      subscription,
      plan
    );

    // A free period charges nothing, so there is nothing to tell.
    if (amountMinor === 0) return;

    this.events.emit(
      RenewalUpcomingEvent.name,
      new RenewalUpcomingEvent(customer.userId, subscription.id, {
        renewsAt: subscription.renewalNoticeFor,
        amount: { amountMinor, currency }
      })
    );
  }
}

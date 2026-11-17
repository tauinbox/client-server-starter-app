import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  crossesZero,
  isSameUsage,
  type BalanceChange
} from '@app/shared/utils/billing-rules';
import { Money } from '@app/shared/utils/money';
import {
  ErrorKeys,
  METERS,
  USAGE_FUTURE_TOLERANCE_MS,
  isMeterKey,
  type MeterKey
} from '@app/shared/constants';
import type { MeteringResponse } from '@app/shared/types';
import { ApiError } from '../../../common/errors/api-error';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { AuditService } from '../../audit/audit.service';
import type { AuditLogParams } from '../../audit/audit.service';
import { EntitlementService } from '../../entitlements/entitlement.service';
import { Customer } from '../entities/customer.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CreditBalanceCrossedEvent } from '../events/billing.events';
import { CreditService } from './credit.service';

export interface ConsumeInput {
  meterKey: string;
  units: number;
  idempotencyKey: string;
  /** ISO 8601 string (HTTP ingest) or Date (in-process producers). Now if omitted. */
  occurredAt?: Date | string;
}

export interface ConsumeOptions {
  /** Written for each new record, not for a replay; `targetId` is its id. */
  audit?: Omit<AuditLogParams, 'targetId'>;
}

interface CheckedInput {
  meterKey: MeterKey;
  units: number;
  idempotencyKey: string;
  occurredAt: Date;
  /** The `occurredAt` of the request; a replay compares time only when it is set. */
  requestedOccurredAt: Date | string | undefined;
}

interface DebitOutcome {
  response: MeteringResponse;
  change: BalanceChange | null;
}

/**
 * Pay as you go: each metered use takes its units from the prepaid credit
 * balance at the moment of use. The balance row is read `FOR UPDATE`, and the
 * usage record and the debit commit in that transaction, so two debits of one
 * customer serialize and the second sees the balance that the first left. A
 * covered use of a customer with no balance row takes no lock: the unique index
 * on the idempotency key decides between two calls with one key. A
 * use that the balance does not cover is refused with
 * `errors.billing.insufficientCredits`; the balance never goes below 0 from a
 * use.
 *
 * A customer whose entitled subscription plan has the capability of the meter
 * is not debited: a fixed plan buys unlimited use for its period. The use is
 * still recorded under its key, with the subscription that covered it, so a
 * retry after the plan ends replays it and takes no credits. The idempotency
 * key is unique per customer: a replay with the same body answers the first
 * record and debits nothing, and another body under the same key is refused.
 */
@Injectable()
export class MeteringService {
  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecords: Repository<UsageRecord>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credits: CreditService,
    private readonly entitlements: EntitlementService,
    private readonly events: EventEmitter2,
    private readonly auditService: AuditService
  ) {}

  async consume(
    customerId: string,
    input: ConsumeInput,
    { audit }: ConsumeOptions = {}
  ): Promise<MeteringResponse> {
    const checked = checkInput(input);
    let outcome: DebitOutcome;

    try {
      outcome = await withTransaction(this.dataSource, (manager) =>
        this.debit(manager, customerId, checked)
      );
    } catch (error: unknown) {
      // A covered use with no balance row takes no lock, so two calls with one
      // key can both pass the replay check; the index refuses the second insert,
      // and this answers it as a replay of the first.
      if (isUniqueViolation(error)) {
        const winner = await this.usageRecords.findOne({
          where: { customerId, idempotencyKey: checked.idempotencyKey }
        });

        if (winner) {
          assertSameBody(winner, input);
          const balance = await this.credits.getBalance(customerId);

          return replayOf(winner, balance?.balanceUnits.toNumber() ?? 0);
        }
      }

      throw error;
    }

    const { response, change } = outcome;

    if (audit && !response.replayed) {
      this.auditService.logFireAndForget({
        ...audit,
        targetId: response.recordId
      });
    }

    if (change && crossesZero(change)) {
      await this.emitCrossing(customerId, change.after);
    }

    return response;
  }

  private async debit(
    manager: EntityManager,
    customerId: string,
    input: CheckedInput
  ): Promise<DebitOutcome> {
    const { meterKey, units, idempotencyKey, occurredAt, requestedOccurredAt } =
      input;
    const balance = await this.credits.lockedBalance(manager, customerId);
    const existing = await manager.findOne(UsageRecord, {
      where: { customerId, idempotencyKey }
    });

    if (existing) {
      assertSameBody(existing, {
        meterKey,
        units,
        occurredAt: requestedOccurredAt
      });

      return { response: replayOf(existing, balance), change: null };
    }

    const entitled = await this.entitlements.entitledSubscription(customerId);
    const coveredBy = entitled?.plan.capabilities.includes(METERS[meterKey])
      ? entitled.subscriptionId
      : null;

    if (coveredBy === null && balance < units) {
      throw new ApiError(
        ErrorKeys.BILLING.INSUFFICIENT_CREDITS,
        'There are not enough credits for this use. Top up credits.'
      );
    }

    const record = await manager.save(
      manager.create(UsageRecord, {
        customerId,
        subscriptionId: coveredBy,
        meterKey,
        quantity: Money.fromMinor(units),
        occurredAt,
        idempotencyKey
      })
    );

    if (coveredBy !== null) {
      return {
        response: {
          recordId: record.id,
          debited: false,
          replayed: false,
          balanceAfter: balance
        },
        change: null
      };
    }

    const change = await this.credits.spendOnMetering(
      manager,
      { customerId, usageRecordId: record.id },
      units
    );

    return {
      response: {
        recordId: record.id,
        debited: true,
        replayed: false,
        balanceAfter: change.after
      },
      change
    };
  }

  private async emitCrossing(
    customerId: string,
    balanceAfter: number
  ): Promise<void> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      select: { id: true, userId: true }
    });

    if (customer) {
      this.events.emit(
        CreditBalanceCrossedEvent.name,
        new CreditBalanceCrossedEvent(customer.userId, balanceAfter)
      );
    }
  }
}

function checkInput(input: ConsumeInput): CheckedInput {
  const { meterKey, units, idempotencyKey } = input;

  if (!isMeterKey(meterKey)) {
    throw new ApiError(
      ErrorKeys.BILLING.METER_NOT_DECLARED,
      `Meter "${meterKey}" is not in the meter catalog`
    );
  }

  const now = Date.now();
  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : new Date(now);

  if (occurredAt.getTime() > now + USAGE_FUTURE_TOLERANCE_MS) {
    throw new ApiError(
      ErrorKeys.BILLING.USAGE_IN_FUTURE,
      'occurredAt is in the future'
    );
  }

  return {
    meterKey,
    units,
    idempotencyKey,
    occurredAt,
    requestedOccurredAt: input.occurredAt
  };
}

function assertSameBody(
  existing: UsageRecord,
  input: Pick<ConsumeInput, 'meterKey' | 'units' | 'occurredAt'>
): void {
  const { meterKey, quantity, occurredAt } = existing;

  if (
    !isSameUsage({ meterKey, units: quantity.toNumber(), occurredAt }, input)
  ) {
    throw new ApiError(
      ErrorKeys.BILLING.USAGE_KEY_REUSED,
      'This idempotency key was already used for another usage record.'
    );
  }
}

function replayOf(record: UsageRecord, balance: number): MeteringResponse {
  return {
    recordId: record.id,
    debited: record.subscriptionId === null,
    replayed: true,
    balanceAfter: balance
  };
}

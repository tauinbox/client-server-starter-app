import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import {
  CreditService,
  crossesZero,
  type BalanceChange
} from './credit.service';

export interface ConsumeInput {
  meterKey: string;
  units: number;
  idempotencyKey: string;
  /** ISO 8601 string (HTTP ingest) or Date (in-process producers). Now if omitted. */
  occurredAt?: Date | string;
}

export interface ConsumeOptions {
  /** Written for a debit only; `targetId` is the id of its new record. */
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
 * usage record and the debit commit in that transaction, so two uses of one
 * customer serialize and the second sees the balance that the first left. A
 * use that the balance does not cover is refused with
 * `errors.billing.insufficientCredits`; the balance never goes below 0 from a
 * use.
 *
 * A customer whose entitled subscription plan has the capability of the meter
 * is not debited: a fixed plan buys unlimited use for its period, and nothing
 * is recorded. The idempotency key is unique per customer: a replay with the
 * same body answers the first record and debits nothing, and another body under
 * the same key is refused.
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
      // The balance lock serializes the writers of one customer, so this only
      // answers a writer that inserted the key outside `consume`.
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

    if (audit && change && response.recordId) {
      this.auditService.logFireAndForget({
        ...audit,
        targetId: response.recordId
      });
    }

    if (change && crossesZero(change)) {
      await this.emitCrossing(customerId);
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

    const plan = await this.entitlements.subscriptionPlan(customerId);

    if (plan?.capabilities.includes(METERS[meterKey])) {
      return {
        response: {
          recordId: null,
          debited: false,
          replayed: false,
          balanceAfter: balance
        },
        change: null
      };
    }

    if (balance < units) {
      throw new ApiError(
        ErrorKeys.BILLING.INSUFFICIENT_CREDITS,
        'There are not enough credits for this use. Top up credits.'
      );
    }

    const record = await manager.save(
      manager.create(UsageRecord, {
        customerId,
        subscriptionId: null,
        meterKey,
        quantity: Money.fromMinor(units),
        occurredAt,
        idempotencyKey
      })
    );
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

  private async emitCrossing(customerId: string): Promise<void> {
    const customer = await this.customers.findOne({
      where: { id: customerId },
      select: { id: true, userId: true }
    });

    if (customer) {
      this.events.emit(
        CreditBalanceCrossedEvent.name,
        new CreditBalanceCrossedEvent(customer.userId)
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

/**
 * A key replays one request. Another meter, quantity or `occurredAt` under the
 * same key is a different use, and answering the first one would drop its
 * units with no error. A retry that omits `occurredAt` is not compared on
 * time, because the first call may have taken the default of now.
 */
function assertSameBody(
  existing: UsageRecord,
  input: Pick<ConsumeInput, 'meterKey' | 'units' | 'occurredAt'>
): void {
  const { meterKey, quantity, occurredAt } = existing;
  const sameTime =
    input.occurredAt === undefined ||
    new Date(input.occurredAt).getTime() === occurredAt.getTime();

  if (
    meterKey !== input.meterKey ||
    !quantity.equals(Money.fromMinor(input.units)) ||
    !sameTime
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
    debited: true,
    replayed: true,
    balanceAfter: balance
  };
}

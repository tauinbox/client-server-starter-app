import type { HttpException, Type } from '@nestjs/common';
import type { BillingProviderId } from '@app/shared/types';
import type { Plan } from '../entities/plan.entity';

/** A refusal answers its status class and the key that the client translates. */
export async function expectRefusal(
  action: Promise<unknown>,
  type: Type<HttpException>,
  errorKey: string
): Promise<void> {
  const error: unknown = await action.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(type);
  expect(error).toMatchObject({ response: { errorKey } });
}

export type QueryBuilderMock = {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
};

export type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  createQueryBuilder: jest.Mock;
  qb: QueryBuilderMock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
};

/** Chainable query-builder stub; `getMany` is what each test drives. */
function queryBuilder(): QueryBuilderMock {
  const qb: Partial<QueryBuilderMock> = {};
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb as QueryBuilderMock;
}

export function repo(): RepoMock {
  const qb = queryBuilder();
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    qb,
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn((entity: { id?: string }) =>
      Promise.resolve({ id: 'generated-id', ...entity })
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 })
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-pro',
    key: 'pro',
    name: 'Pro',
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: ['reports'],
    limits: null,
    trialDays: 0,
    active: true,
    prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function provider(
  id: BillingProviderId,
  managesLifecycle: boolean
): {
  id: BillingProviderId;
  managesLifecycle: boolean;
  startCheckout: jest.Mock;
  updatePaymentMethod: jest.Mock;
  cancel: jest.Mock;
  changePlan: jest.Mock;
  previewChangePlan: jest.Mock;
  chargeOffSession: jest.Mock;
  createOneTimePayment: jest.Mock;
  refund: jest.Mock;
} {
  return {
    id,
    managesLifecycle,
    startCheckout: jest
      .fn()
      .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' }),
    createOneTimePayment: jest
      .fn()
      .mockResolvedValue({ url: 'https://pay/x', sessionRef: 'ot-1' }),
    updatePaymentMethod: jest
      .fn()
      .mockResolvedValue({ url: 'https://method/x', sessionRef: 'mu-1' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    changePlan: jest.fn().mockResolvedValue(undefined),
    previewChangePlan: jest
      .fn()
      .mockResolvedValue({ amountMinor: 1700, currency: 'USD' }),
    chargeOffSession: jest.fn().mockResolvedValue({
      providerInvoiceRef: 'pay_change',
      status: 'captured'
    }),
    refund: jest.fn().mockResolvedValue(undefined)
  };
}

import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';
import { Customer } from '../entities/customer.entity';
import { Subscription } from '../entities/subscription.entity';
import { BILLING_PROVIDERS } from '../providers/payment-provider.interface';
import { BillingUserDeletedListener } from './billing-user-deleted.listener';

describe('BillingUserDeletedListener', () => {
  let listener: BillingUserDeletedListener;
  let customers: { findOne: jest.Mock };
  let subscriptions: { find: jest.Mock };
  let paddleCancel: jest.Mock;
  let yookassaCancel: jest.Mock;

  beforeEach(async () => {
    customers = { findOne: jest.fn().mockResolvedValue(null) };
    subscriptions = { find: jest.fn().mockResolvedValue([]) };
    paddleCancel = jest.fn().mockResolvedValue(undefined);
    yookassaCancel = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingUserDeletedListener,
        { provide: getRepositoryToken(Customer), useValue: customers },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
        {
          provide: BILLING_PROVIDERS,
          useValue: [
            { id: 'paddle', cancel: paddleCancel },
            { id: 'yookassa', cancel: yookassaCancel }
          ]
        }
      ]
    }).compile();

    listener = module.get(BillingUserDeletedListener);
  });

  it('does nothing when the user is not a billing customer', async () => {
    await listener.handleUserDeleted(new UserDeletedEvent('user-1'));
    expect(subscriptions.find).not.toHaveBeenCalled();
    expect(paddleCancel).not.toHaveBeenCalled();
  });

  it('cancels an active subscription at its own provider', async () => {
    customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-1',
        provider: 'paddle',
        status: 'active',
        providerSubscriptionId: 'pad_123'
      }
    ]);
    await listener.handleUserDeleted(new UserDeletedEvent('user-1'));
    expect(paddleCancel).toHaveBeenCalledWith('pad_123', 'immediate');
    expect(yookassaCancel).not.toHaveBeenCalled();
  });

  it('skips already-canceled subscriptions and ones without a provider id', async () => {
    customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-1',
        provider: 'paddle',
        status: 'canceled',
        providerSubscriptionId: 'pad_123'
      },
      {
        id: 'sub-2',
        provider: 'yookassa',
        status: 'active',
        providerSubscriptionId: null
      }
    ]);
    await listener.handleUserDeleted(new UserDeletedEvent('user-1'));
    expect(paddleCancel).not.toHaveBeenCalled();
    expect(yookassaCancel).not.toHaveBeenCalled();
  });

  it('swallows a provider cancel failure so account deletion is not blocked', async () => {
    customers.findOne.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });
    subscriptions.find.mockResolvedValue([
      {
        id: 'sub-1',
        provider: 'paddle',
        status: 'active',
        providerSubscriptionId: 'pad_123'
      }
    ]);
    paddleCancel.mockRejectedValue(new Error('provider down'));
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(
      listener.handleUserDeleted(new UserDeletedEvent('user-1'))
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

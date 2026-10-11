import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FirstPaymentUnclaimedEvent } from '../events/billing.events';
import { BillingAdminService } from '../services/billing-admin.service';
import { FirstPaymentUnclaimedListener } from './first-payment-unclaimed.listener';

describe('FirstPaymentUnclaimedListener', () => {
  const refundInvoice = jest.fn();
  let listener: FirstPaymentUnclaimedListener;

  beforeEach(async () => {
    refundInvoice.mockReset();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      providers: [
        FirstPaymentUnclaimedListener,
        { provide: BillingAdminService, useValue: { refundInvoice } }
      ]
    }).compile();
    listener = module.get(FirstPaymentUnclaimedListener);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refunds the whole invoice', async () => {
    refundInvoice.mockResolvedValue({});

    await listener.handle(new FirstPaymentUnclaimedEvent('user-1', 'inv-2'));

    expect(refundInvoice).toHaveBeenCalledWith('inv-2');
  });

  it('logs a failed refund and does not throw', async () => {
    refundInvoice.mockRejectedValue(new Error('provider down'));

    await expect(
      listener.handle(new FirstPaymentUnclaimedEvent('user-1', 'inv-2'))
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('inv-2'),
      expect.any(String)
    );
  });
});

import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RenewalProcessor } from './renewal.processor';
import { RenewalService } from './renewal.service';
import {
  BILLING_RENEWAL_SCAN_JOB,
  BILLING_RENEWAL_SCHEDULER_ID,
  RENEWAL_SCAN_INTERVAL_MS
} from './renewal-queue.constants';

describe('RenewalProcessor', () => {
  let runDueRenewals: jest.Mock;
  let upsertJobScheduler: jest.Mock;
  let processor: RenewalProcessor;

  beforeEach(() => {
    runDueRenewals = jest.fn().mockResolvedValue(undefined);
    upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const renewals: Pick<RenewalService, 'runDueRenewals'> = {
      runDueRenewals
    };
    const queue: Pick<Queue, 'upsertJobScheduler'> = { upsertJobScheduler };
    processor = new RenewalProcessor(
      renewals as RenewalService,
      queue as Queue
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('upserts the scan scheduler on bootstrap', async () => {
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_RENEWAL_SCHEDULER_ID,
      { every: RENEWAL_SCAN_INTERVAL_MS },
      { name: BILLING_RENEWAL_SCAN_JOB, data: {} }
    );
  });

  it('runs the due renewals once for each scan job', async () => {
    await processor.process();

    expect(runDueRenewals).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed scan, so BullMQ marks the job failed', async () => {
    const failure = new Error('scan failed');
    runDueRenewals.mockRejectedValueOnce(failure);

    await expect(processor.process()).rejects.toBe(failure);
  });

  it('logs a failed job with its id and error', () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('scan failed');
    const job: Pick<Job, 'id'> = { id: 'job-7' };

    processor.onFailed(job as Job, failure);

    expect(error).toHaveBeenCalledWith(
      'Renewal scan job job-7 failed',
      failure
    );
  });
});

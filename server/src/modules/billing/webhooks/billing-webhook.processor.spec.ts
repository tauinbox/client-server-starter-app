import { Job, Queue } from 'bullmq';
import { BillingWebhookProcessor } from './billing-webhook.processor';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WebhookReconciliationService } from './webhook-reconciliation.service';
import { WebhookRetentionService } from './webhook-retention.service';
import {
  BILLING_WEBHOOK_RECONCILE_JOB,
  BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
  BILLING_WEBHOOK_REDUCE_JOB,
  BILLING_WEBHOOK_RETENTION_JOB,
  BILLING_WEBHOOK_RETENTION_SCHEDULER_ID,
  WEBHOOK_RECONCILE_INTERVAL_MS,
  WEBHOOK_RETENTION_INTERVAL_MS,
  type BillingWebhookJobData
} from './billing-webhook-queue.constants';

function makeJob(
  name: string,
  data: Partial<BillingWebhookJobData> = {}
): Job<BillingWebhookJobData> {
  return { name, data } as Partial<
    Job<BillingWebhookJobData>
  > as Job<BillingWebhookJobData>;
}

describe('BillingWebhookProcessor', () => {
  let processEvent: jest.Mock;
  let sweep: jest.Mock;
  let pruneLedger: jest.Mock;
  let upsertJobScheduler: jest.Mock;
  let processor: BillingWebhookProcessor;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    processEvent = jest.fn().mockResolvedValue(undefined);
    sweep = jest.fn().mockResolvedValue(undefined);
    pruneLedger = jest.fn().mockResolvedValue(undefined);
    upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const ingestion: Pick<WebhookIngestionService, 'processEvent'> = {
      processEvent
    };
    const reconciliation: Pick<WebhookReconciliationService, 'sweep'> = {
      sweep
    };
    const retention: Pick<WebhookRetentionService, 'sweep'> = {
      sweep: pruneLedger
    };
    const queue: Pick<Queue, 'upsertJobScheduler'> = { upsertJobScheduler };
    processor = new BillingWebhookProcessor(
      ingestion as WebhookIngestionService,
      reconciliation as WebhookReconciliationService,
      retention as WebhookRetentionService,
      queue as Queue
    );
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('reduces a normal reduce job', async () => {
    const data = { webhookEventId: 'wh-1' };
    await processor.process(makeJob(BILLING_WEBHOOK_REDUCE_JOB, data));

    expect(processEvent).toHaveBeenCalledWith(data);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('runs the reconciliation sweep for the reconcile job', async () => {
    await processor.process(makeJob(BILLING_WEBHOOK_RECONCILE_JOB));

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(pruneLedger).not.toHaveBeenCalled();
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('runs the retention sweep for the retention job', async () => {
    await processor.process(makeJob(BILLING_WEBHOOK_RETENTION_JOB));

    expect(pruneLedger).toHaveBeenCalledTimes(1);
    expect(sweep).not.toHaveBeenCalled();
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('upserts both schedulers on bootstrap outside tests', async () => {
    process.env['NODE_ENV'] = 'development';
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
      { every: WEBHOOK_RECONCILE_INTERVAL_MS },
      { name: BILLING_WEBHOOK_RECONCILE_JOB, data: {} }
    );
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_WEBHOOK_RETENTION_SCHEDULER_ID,
      { every: WEBHOOK_RETENTION_INTERVAL_MS },
      { name: BILLING_WEBHOOK_RETENTION_JOB, data: {} }
    );
  });

  it('does not schedule under test (avoids polluting Redis)', async () => {
    process.env['NODE_ENV'] = 'test';
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });
});

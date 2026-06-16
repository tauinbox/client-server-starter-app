import { Job, Queue } from 'bullmq';
import { BillingWebhookProcessor } from './billing-webhook.processor';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WebhookReconciliationService } from './webhook-reconciliation.service';
import {
  BILLING_WEBHOOK_RECONCILE_JOB,
  BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
  BILLING_WEBHOOK_REDUCE_JOB,
  WEBHOOK_RECONCILE_INTERVAL_MS,
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
  let upsertJobScheduler: jest.Mock;
  let processor: BillingWebhookProcessor;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    processEvent = jest.fn().mockResolvedValue(undefined);
    sweep = jest.fn().mockResolvedValue(undefined);
    upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
    const ingestion: Pick<WebhookIngestionService, 'processEvent'> = {
      processEvent
    };
    const reconciliation: Pick<WebhookReconciliationService, 'sweep'> = {
      sweep
    };
    const queue: Pick<Queue, 'upsertJobScheduler'> = { upsertJobScheduler };
    processor = new BillingWebhookProcessor(
      ingestion as WebhookIngestionService,
      reconciliation as WebhookReconciliationService,
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
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('upserts the reconcile scheduler on bootstrap outside tests', async () => {
    process.env['NODE_ENV'] = 'development';
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_WEBHOOK_RECONCILE_SCHEDULER_ID,
      { every: WEBHOOK_RECONCILE_INTERVAL_MS },
      { name: BILLING_WEBHOOK_RECONCILE_JOB, data: {} }
    );
  });

  it('does not schedule under test (avoids polluting Redis)', async () => {
    process.env['NODE_ENV'] = 'test';
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });
});

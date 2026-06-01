import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { MAIL_QUEUE, MailJobData } from './mail-queue.constants';
import {
  MAIL_QUEUE_REF,
  type MailQueueRef
} from '../core/metrics/metrics.module';
import { MetricsService } from '../core/metrics/metrics.service';

interface ProcessorHarness {
  processor: MailProcessor;
  deliver: jest.Mock;
  recordMailJob: jest.Mock;
  getJobCounts: jest.Mock;
  mailQueueRef: MailQueueRef;
}

async function createProcessor(
  deliver: jest.Mock = jest.fn().mockResolvedValue(undefined)
): Promise<ProcessorHarness> {
  const recordMailJob = jest.fn();
  const getJobCounts = jest.fn().mockResolvedValue({ waiting: 2, failed: 1 });
  const mailQueueRef: MailQueueRef = { getJobCounts: () => null };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      MailProcessor,
      { provide: MailService, useValue: { deliver } },
      { provide: getQueueToken(MAIL_QUEUE), useValue: { getJobCounts } },
      { provide: MAIL_QUEUE_REF, useValue: mailQueueRef },
      { provide: MetricsService, useValue: { recordMailJob } }
    ]
  }).compile();

  return {
    processor: moduleRef.get<MailProcessor>(MailProcessor),
    deliver,
    recordMailJob,
    getJobCounts,
    mailQueueRef
  };
}

describe('MailProcessor', () => {
  it('delivers the job payload via MailService', async () => {
    const { processor, deliver } = await createProcessor();

    const data: MailJobData = {
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>hello</p>'
    };
    // @ts-expect-error minimal Job stub — process() only reads `data`
    const job: Job<MailJobData> = { data };
    await processor.process(job);

    expect(deliver).toHaveBeenCalledWith(data);
  });

  it('propagates delivery errors so BullMQ can retry', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('smtp down'));
    const { processor } = await createProcessor(deliver);

    // @ts-expect-error minimal Job stub — process() only reads `data`
    const job: Job<MailJobData> = {
      data: { to: 'user@example.com', subject: 'Hi', html: '<p>x</p>' }
    };
    await expect(processor.process(job)).rejects.toThrow('smtp down');
  });

  it('wires the queue-depth ref to the queue job counts', async () => {
    const { mailQueueRef, getJobCounts } = await createProcessor();

    const counts = await mailQueueRef.getJobCounts();

    expect(getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed'
    );
    expect(counts).toEqual({ waiting: 2, failed: 1 });
  });

  it('records a completed outcome on the completed worker event', async () => {
    const { processor, recordMailJob } = await createProcessor();

    processor.onCompleted();

    expect(recordMailJob).toHaveBeenCalledWith('completed');
  });

  it('records a failed outcome on the failed worker event', async () => {
    const { processor, recordMailJob } = await createProcessor();

    // @ts-expect-error minimal Job stub — onFailed only reads logging fields
    const job: Job<MailJobData> = {
      id: '1',
      attemptsMade: 3,
      data: { to: 'user@example.com', subject: 'Hi', html: '<p>x</p>' }
    };
    processor.onFailed(job, new Error('smtp down'));

    expect(recordMailJob).toHaveBeenCalledWith('failed');
  });
});

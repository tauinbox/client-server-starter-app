import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { MailJobData } from './mail-queue.constants';

describe('MailProcessor', () => {
  it('delivers the job payload via MailService', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        { provide: MailService, useValue: { deliver } }
      ]
    }).compile();
    const processor = moduleRef.get<MailProcessor>(MailProcessor);

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
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        { provide: MailService, useValue: { deliver } }
      ]
    }).compile();
    const processor = moduleRef.get<MailProcessor>(MailProcessor);

    // @ts-expect-error minimal Job stub — process() only reads `data`
    const job: Job<MailJobData> = {
      data: { to: 'user@example.com', subject: 'Hi', html: '<p>x</p>' }
    };
    await expect(processor.process(job)).rejects.toThrow('smtp down');
  });
});

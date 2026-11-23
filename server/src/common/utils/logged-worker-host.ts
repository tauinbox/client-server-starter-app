import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { formatOf } from './job-format';
import { ThrottledFailureLog } from './redis-client';

/** Delay before a node of an older build offers a job of a newer format again. */
export const NEWER_FORMAT_RETRY_DELAY_MS = 5000;

/**
 * A worker host that sends the errors of its worker loop to the logger, at
 * most once in each throttle window. With no `error` listener BullMQ writes
 * each one to stderr as a raw multi-line dump: a boot on a full Redis wrote
 * about 9100 of them in 5 seconds.
 */
export abstract class LoggedWorkerHost extends WorkerHost {
  readonly #workerErrors = new ThrottledFailureLog(
    new Logger(this.constructor.name),
    'Queue worker loop failed, no job is taken'
  );

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.#workerErrors.log(error);
  }

  /**
   * Gives back a job that a newer build wrote, so that a node of that build
   * runs it. During a rolling deploy BullMQ gives each job to any worker of
   * the queue. A delayed job spends no attempt, so the old nodes cannot move
   * the job to `failed`.
   */
  protected async deferNewerFormat(
    job: Job<object>,
    token: string | undefined,
    known: number
  ): Promise<void> {
    if (formatOf(job.data) <= known) {
      return;
    }

    await job.moveToDelayed(Date.now() + NEWER_FORMAT_RETRY_DELAY_MS, token);

    throw new DelayedError();
  }
}

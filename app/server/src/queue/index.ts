import PQueue from 'p-queue';
import { config } from '../config/index.js';

export interface Job<T=any> {
  id: string;
  run: () => Promise<T>;
}

export class MessagingQueue {
  private q: PQueue;
  private rateLimiter: { intervalCap: number; interval: number };

  constructor(opts?: { concurrency?: number; ratePerSecond?: number }) {
    const concurrency = opts?.concurrency ?? config.queue.concurrency;
    const ratePerSecond = opts?.ratePerSecond ?? config.queue.ratePerSecond;
    this.rateLimiter = { intervalCap: ratePerSecond, interval: 1000 };
    this.q = new PQueue({
      concurrency,
      intervalCap: ratePerSecond,
      interval: 1000,
      carryoverConcurrencyCount: true,
    });
  }

  add<T>(job: Job<T>): Promise<T> {
    return this.q.add(job.run, { priority: 0 }) as Promise<T>;
  }

  async addAll<T>(jobs: Job<T>[]): Promise<T[]> {
    return Promise.all(jobs.map(j => this.add(j)));
  }

  get size() { return this.q.size; }
  get pending() { return this.q.pending; }
  async onIdle() { return this.q.onIdle(); }
  clear() { this.q.clear(); }
}

export const messagingQueue = new MessagingQueue();

// Swappable interface for BullMQ later
export interface QueueProvider {
  add<T>(job: Job<T>): Promise<T>;
  addAll<T>(jobs: Job<T>[]): Promise<T[]>;
}

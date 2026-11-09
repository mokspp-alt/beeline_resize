import type { LlmUsage } from './types.js';

/** Ограничение параллельных запросов к LLM на пользователя (очередь, а не отказ). */
export class UserLimiter {
  private active = new Map<string, number>();
  private queues = new Map<string, Array<() => void>>();

  constructor(private max: number) {}

  async run<T>(user: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(user);
    try {
      return await fn();
    } finally {
      this.release(user);
    }
  }

  private acquire(user: string): Promise<void> {
    const n = this.active.get(user) ?? 0;
    if (n < this.max) {
      this.active.set(user, n + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const q = this.queues.get(user) ?? [];
      q.push(() => {
        this.active.set(user, (this.active.get(user) ?? 0) + 1);
        resolve();
      });
      this.queues.set(user, q);
    });
  }

  private release(user: string) {
    this.active.set(user, (this.active.get(user) ?? 1) - 1);
    const next = this.queues.get(user)?.shift();
    if (next) next();
    else if ((this.active.get(user) ?? 0) <= 0) this.active.delete(user);
  }
}

/** Учёт токенов на один запуск адаптации. */
export class RunUsage {
  inputTokens = 0;
  outputTokens = 0;
  calls = 0;

  add(u: LlmUsage) {
    this.inputTokens += u.inputTokens;
    this.outputTokens += u.outputTokens;
    this.calls += 1;
  }

  toJSON() {
    return { calls: this.calls, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}

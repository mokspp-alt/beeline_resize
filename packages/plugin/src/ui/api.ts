import type { DesignIR, DesignSystemConfig, LayoutPlan, PresetCatalog, ReportItem, RoleMap, ScanLibrary, SizePreset, AdaptationMode } from '@beeline-resize/shared';
import { SseParser } from './sse.js';

export interface BackendConfig {
  catalog: PresetCatalog;
  designSystem: DesignSystemConfig | null;
  provider: { name: string; model: string };
  policy: { allowPreview: boolean; maskTexts: boolean };
}

export type AdaptEvent =
  | { type: 'roles'; roles: RoleMap; ai: boolean; reason?: string }
  | { type: 'plan'; plan: LayoutPlan; report: ReportItem[] }
  | { type: 'error'; targetId: string; message: string }
  | { type: 'done'; usage: { calls: number; inputTokens: number; outputTokens: number }; durationMs: number };

export interface AdaptBody {
  ir: DesignIR;
  preview?: string;
  targets: SizePreset[];
  modeOverrides?: Record<string, AdaptationMode>;
  confidential?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  constructor(
    private baseUrl: string,
    private token: string,
    private userId: string,
    private f: typeof fetch = fetch.bind(globalThis),
  ) {}

  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, 'x-figma-user': this.userId, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  private async check(res: Response) {
    if (res.ok) return;
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      // нет тела
    }
    if (res.status === 401) message = 'Неверный командный токен — проверьте настройки';
    throw new ApiError(res.status, message);
  }

  async config(): Promise<BackendConfig> {
    const res = await this.f(`${this.baseUrl}/config`, { headers: this.headers() });
    await this.check(res);
    return (await res.json()) as BackendConfig;
  }

  async scan(): Promise<ScanLibrary[]> {
    const res = await this.f(`${this.baseUrl}/ds/scan`, { method: 'POST', headers: this.headers() });
    await this.check(res);
    return ((await res.json()) as { libraries: ScanLibrary[] }).libraries;
  }

  /** Потоковая адаптация: события отдаются по мере прихода. */
  async adapt(body: AdaptBody, signal: AbortSignal, onEvent: (e: AdaptEvent) => void): Promise<void> {
    const res = await this.f(`${this.baseUrl}/adapt`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(body), signal });
    await this.check(res);
    if (!res.body) throw new ApiError(0, 'пустой ответ');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) onEvent(JSON.parse(m.data) as AdaptEvent);
    }
  }
}

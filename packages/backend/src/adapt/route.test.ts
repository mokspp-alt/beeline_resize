import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { DEFAULT_CATALOG, LayoutPlanSchema } from '@beeline-resize/shared';
import { buildApp } from '../app.js';
import { settingsFromEnv } from '../settings.js';
import { promoBanner } from '../test/fixtures.js';
import type { LlmProvider } from '../llm/types.js';
import type { AdaptEvent } from './run.js';

const CONFIG = path.resolve(__dirname, '../../../../config');
const settings = settingsFromEnv({ PLUGIN_TOKEN: 't', LLM_PROVIDER: 'none' });
const auth = { authorization: 'Bearer t', 'content-type': 'application/json' };

function parseSse(body: string): AdaptEvent[] {
  return body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice(7);
      const data = JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)) as AdaptEvent;
      expect(data.type).toBe(event);
      return data;
    });
}

const targets = ['web:360xauto', 'app-ios:393x852', 'banner-display:300x250', 'banner-display:728x90'].map(
  (id) => DEFAULT_CATALOG.presets.find((p) => p.id === id)!,
);

describe('POST /adapt (SSE)', () => {
  it('поток: roles → plan по каждому размеру → done; без провайдера — фолбэк', async () => {
    const app = buildApp({ settings, configDir: CONFIG, provider: null });
    const res = await app.inject({ method: 'POST', url: '/adapt', headers: auth, payload: { ir: promoBanner(), targets } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['access-control-allow-origin']).toBe('*');

    const events = parseSse(res.body);
    expect(events[0]!.type).toBe('roles');
    expect(events.at(-1)!.type).toBe('done');
    const plans = events.filter((e): e is Extract<AdaptEvent, { type: 'plan' }> => e.type === 'plan');
    expect(plans.map((p) => p.plan.targetId).sort()).toEqual(targets.map((t) => t.id).sort());
    for (const p of plans) {
      expect(LayoutPlanSchema.safeParse(p.plan).success).toBe(true);
      expect(p.plan.ai).toBe(false);
      expect(p.report[0]).toMatchObject({ kind: 'fallback', message: 'без AI: провайдер не настроен' });
    }
    // режимы по группам: web, app, banner
    expect(Object.fromEntries(plans.map((p) => [p.plan.targetId, p.plan.mode]))).toEqual({
      'web:360xauto': 'web',
      'app-ios:393x852': 'app',
      'banner-display:300x250': 'banner',
      'banner-display:728x90': 'banner',
    });
  });

  it('с провайдером: AI-планы и учёт токенов в done', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      model: 'fake',
      supportsImages: false,
      complete: async (r) => ({
        text: r.system.includes('Определи смысловую роль')
          ? JSON.stringify({ elements: [{ nodeId: 'title', role: 'heading', priority: 90, group: 'offer', focal: null }] })
          : JSON.stringify({ composition: 'stack', columns: null, order: ['logo', 'title', 'cta'], hide: [], focal: [], containers: [], notes: [] }),
        usage: { inputTokens: 1000, outputTokens: 100 },
      }),
    };
    const app = buildApp({ settings, configDir: CONFIG, provider });
    const res = await app.inject({ method: 'POST', url: '/adapt', headers: auth, payload: { ir: promoBanner(), targets: targets.slice(2, 3) } });
    const events = parseSse(res.body);
    expect(events.find((e) => e.type === 'roles')).toMatchObject({ ai: true });
    expect(events.find((e) => e.type === 'plan')).toMatchObject({ plan: { ai: true } });
    expect(events.find((e) => e.type === 'done')).toMatchObject({ usage: { calls: 2, inputTokens: 2000, outputTokens: 200 } });
  });

  it('невалидное тело — 400, без авторизации — 401, preflight — 204', async () => {
    const app = buildApp({ settings, configDir: CONFIG, provider: null });
    expect((await app.inject({ method: 'POST', url: '/adapt', headers: auth, payload: { ir: {}, targets: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/adapt', payload: { ir: promoBanner(), targets } })).statusCode).toBe(401);
    const pre = await app.inject({ method: 'OPTIONS', url: '/adapt', headers: { origin: 'null', 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toContain('authorization');
  });
});

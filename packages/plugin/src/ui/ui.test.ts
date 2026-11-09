import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '@beeline-resize/shared';
import { SseParser } from './sse.js';
import { Api } from './api.js';
import { progress, isRunning, type TargetRow } from './state.js';

describe('SSE-парсер', () => {
  it('собирает события из произвольно нарезанных кусков', () => {
    const p = new SseParser();
    const text = 'event: roles\ndata: {"type":"roles"}\n\nevent: plan\ndata: {"type":"plan","n":1}\n\nevent: done\ndata: {"type":"done"}\n\n';
    const out = [];
    for (let i = 0; i < text.length; i += 7) out.push(...p.push(text.slice(i, i + 7)));
    expect(out.map((m) => m.event)).toEqual(['roles', 'plan', 'done']);
    expect(JSON.parse(out[1]!.data)).toEqual({ type: 'plan', n: 1 });
  });
});

describe('клиент API', () => {
  it('адаптация: поток событий, токен и id пользователя в заголовках', async () => {
    let headers: Headers | undefined;
    const body = 'event: roles\ndata: {"type":"roles","ai":false}\n\nevent: done\ndata: {"type":"done"}\n\n';
    const f = (async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(new Blob([body]).stream(), { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const events: unknown[] = [];
    await new Api('http://b', 'tok', 'u1', f).adapt({ ir: {} as never, targets: [] }, new AbortController().signal, (e) => events.push(e));
    expect(events).toEqual([{ type: 'roles', ai: false }, { type: 'done' }]);
    expect(headers!.get('authorization')).toBe('Bearer tok');
    expect(headers!.get('x-figma-user')).toBe('u1');
  });

  it('401 → понятное сообщение про токен', async () => {
    const f = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(new Api('http://b', 'bad', 'u', f).config()).rejects.toThrow(/командный токен/);
  });
});

describe('прогресс по размерам', () => {
  const presets = DEFAULT_CATALOG.presets.slice(0, 3);
  let rows: TargetRow[] = progress([], { type: 'start', presets });

  it('в очереди → обработка → готово / ошибка', () => {
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
    rows = progress(rows, { type: 'roles' });
    expect(isRunning(rows)).toBe(true);
    rows = progress(rows, { type: 'applied', targetId: presets[0]!.id, frameId: 'f1', name: 'n', report: [] });
    rows = progress(rows, { type: 'error', targetId: presets[1]!.id, message: 'упало' });
    expect(rows.map((r) => r.status)).toEqual(['done', 'error', 'processing']);
  });

  it('отмена: незавершённые — «отменено», готовые остаются', () => {
    const after = progress(rows, { type: 'cancel' });
    expect(after.map((r) => r.status)).toEqual(['done', 'error', 'cancelled']);
    expect(isRunning(after)).toBe(false);
  });
});

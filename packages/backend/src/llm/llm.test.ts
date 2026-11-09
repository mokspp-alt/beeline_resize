import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DesignIR } from '@beeline-resize/shared';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.js';
import { GigaChatProvider } from './providers/gigachat.js';
import { YandexGptProvider } from './providers/yandexgpt.js';
import { createProvider } from './factory.js';
import { extractJson, generateStructured } from './structured.js';
import { applyDataPolicy, maskText } from './policy.js';
import { RunUsage, UserLimiter } from './limits.js';
import { LlmError, fallbackReason, type FetchLike, type LlmProvider, type LlmRequest } from './types.js';
import { settingsFromEnv } from '../settings.js';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/** fetch, который запоминает запросы и отдаёт записанные ответы по очереди. */
function recorder(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Captured[] = [];
  const f: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    const text = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // form-urlencoded
    }
    calls.push({ url, headers, body });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  system: 'sys',
  user: 'user',
  schemaName: 'result',
  jsonSchema: schema,
  maxTokens: 1000,
  signal: new AbortController().signal,
  ...over,
});

describe('контракты провайдеров (записанные ответы)', () => {
  it('anthropic: structured outputs, fallbacks default, картинка, usage', async () => {
    const { f, calls } = recorder([
      {
        json: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 8 },
        },
      },
    ]);
    const p = new AnthropicProvider('claude-opus-5-5', 'sk-test', { fetch: f, baseURL: 'https://api.anthropic.com' });
    const res = await p.complete(req({ images: [{ mediaType: 'image/png', data: 'aGk=' }] }));
    expect(res).toEqual({ text: '{"ok":true}', usage: { inputTokens: 120, outputTokens: 8 } });

    const c = calls[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    // SDK передаёт ключ в x-api-key или Authorization: Bearer — в зависимости от версии
    expect(c.headers['x-api-key'] ?? c.headers.authorization).toMatch(/sk-test$/);
    expect(c.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(c.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      system: 'sys',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    });
    expect(c.body.temperature).toBeUndefined();
    expect(c.body.tool_choice).toBeUndefined();
    expect(c.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } });
  });

  it('anthropic: отказ → LlmError(refusal)', async () => {
    const { f } = recorder([
      {
        json: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: null, explanation: null },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ]);
    await expect(new AnthropicProvider('claude-opus-5-5', 'k', { fetch: f, baseURL: 'https://api.anthropic.com' }).complete(req())).rejects.toMatchObject({ kind: 'refusal' });
  });

  it('openai-compatible: json_schema strict, Bearer, usage', async () => {
    const { f, calls } = recorder([
      { json: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 50, completion_tokens: 5 } } },
    ]);
    const p = new OpenAiCompatibleProvider('qwen3-72b', 'http://llm.local/v1/', 'key', { fetch: f });
    const res = await p.complete(req({ images: [{ mediaType: 'image/png', data: 'aGk=' }] }));
    expect(res).toEqual({ text: '{"ok":true}', usage: { inputTokens: 50, outputTokens: 5 } });
    expect(calls[0]!.url).toBe('http://llm.local/v1/chat/completions');
    expect(calls[0]!.headers.authorization).toBe('Bearer key');
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'result', schema, strict: true } });
    // без vision картинки не отправляются
    expect(calls[0]!.body.messages[1].content).toBe('user');
  });

  it('gigachat: OAuth-токен кешируется, function_call обязателен', async () => {
    const { f, calls } = recorder([
      { json: { access_token: 'tok', expires_at: Date.now() + 30 * 60_000 } },
      { json: { choices: [{ message: { function_call: { name: 'result', arguments: { ok: true } } } }], usage: { prompt_tokens: 30, completion_tokens: 4 } } },
      { json: { choices: [{ message: { function_call: { name: 'result', arguments: '{"ok":false}' } } }], usage: { prompt_tokens: 30, completion_tokens: 4 } } },
    ]);
    const p = new GigaChatProvider('GigaChat-2-Max', 'base64key', { fetch: f });
    expect((await p.complete(req())).text).toBe('{"ok":true}');
    expect((await p.complete(req())).text).toBe('{"ok":false}');
    expect(calls).toHaveLength(3); // один OAuth на два запроса
    expect(calls[0]!.headers.authorization).toBe('Basic base64key');
    expect(calls[0]!.headers.rquid).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]!.body).toBe('scope=GIGACHAT_API_PERS');
    expect(calls[1]!.headers.authorization).toBe('Bearer tok');
    expect(calls[1]!.body.function_call).toEqual({ name: 'result' });
    expect(calls[1]!.body.functions[0].parameters).toEqual(schema);
  });

  it('yandexgpt: modelUri, Api-Key, jsonSchema, строковые usage', async () => {
    const { f, calls } = recorder([
      {
        json: {
          result: {
            alternatives: [{ message: { role: 'assistant', text: '{"ok":true}' }, status: 'ALTERNATIVE_STATUS_FINAL' }],
            usage: { inputTextTokens: '40', completionTokens: '6', totalTokens: '46' },
            modelVersion: '1',
          },
        },
      },
    ]);
    const p = new YandexGptProvider('yandexgpt/latest', 'ya-key', 'b1gfolder', { fetch: f });
    expect(await p.complete(req())).toEqual({ text: '{"ok":true}', usage: { inputTokens: 40, outputTokens: 6 } });
    expect(calls[0]!.headers.authorization).toBe('Api-Key ya-key');
    expect(calls[0]!.headers['x-folder-id']).toBe('b1gfolder');
    expect(calls[0]!.body.modelUri).toBe('gpt://b1gfolder/yandexgpt/latest');
    expect(calls[0]!.body.jsonSchema).toEqual({ schema });
  });

  it('HTTP 429 → rate-limit, 500 → http', async () => {
    const p429 = new YandexGptProvider('m', 'k', 'f', { fetch: recorder([{ status: 429, json: {} }]).f });
    await expect(p429.complete(req())).rejects.toMatchObject({ kind: 'rate-limit' });
    const p500 = new OpenAiCompatibleProvider('m', 'http://x', undefined, { fetch: recorder([{ status: 500, json: {} }]).f });
    await expect(p500.complete(req())).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('выбор провайдера конфигурацией', () => {
  const base = { PLUGIN_TOKEN: 't' };
  it('смена провайдера без изменения кода', () => {
    expect(createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }))?.name).toBe('anthropic');
    expect(createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'gigachat', GIGACHAT_AUTH_KEY: 'k' }))?.name).toBe('gigachat');
    expect(
      createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'yandexgpt', YANDEXGPT_API_KEY: 'k', YANDEXGPT_FOLDER_ID: 'f' }))?.name,
    ).toBe('yandexgpt');
    expect(
      createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm', OPENAI_COMPATIBLE_BASE_URL: 'http://x' }))
        ?.name,
    ).toBe('openai-compatible');
    expect(createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'none' }))).toBeUndefined();
  });

  it('модель Claude по умолчанию — claude-opus-5-5', () => {
    expect(createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }))?.model).toBe('claude-opus-5-5');
  });

  it('без ключа — ошибка конфигурации', () => {
    expect(() => createProvider(settingsFromEnv({ ...base, LLM_PROVIDER: 'anthropic' }))).toThrow(/ANTHROPIC_API_KEY/);
  });
});

/** Фейковый провайдер: отдаёт заданные ответы по очереди. */
function fake(answers: Array<string | 'hang'>): LlmProvider & { seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  let i = 0;
  return {
    name: 'fake',
    model: 'fake',
    supportsImages: false,
    seen,
    complete: (r) => {
      seen.push(r);
      const a = answers[Math.min(i++, answers.length - 1)]!;
      if (a === 'hang') return new Promise(() => {});
      return Promise.resolve({ text: a, usage: { inputTokens: 10, outputTokens: 2 } });
    },
  };
}

describe('структурированный ответ', () => {
  const Ok = z.object({ ok: z.boolean() });
  const base = { system: 's', user: 'u', schemaName: 'r', jsonSchema: schema, maxTokens: 100 };

  it('извлекает JSON из ```json-блока', () => {
    expect(extractJson('Вот:\n```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('невалидный ответ → одна повторная попытка с описанием ошибки', async () => {
    const p = fake(['{"ok":"да"}', '{"ok":true}']);
    const r = await generateStructured(p, base, Ok, { timeoutMs: 1000 });
    expect(r).toMatchObject({ value: { ok: true }, attempts: 2, usage: { inputTokens: 20, outputTokens: 4 } });
    expect(p.seen[1]!.user).toContain('не прошёл проверку схемы');
  });

  it('два невалидных ответа → invalid-output и понятная причина фолбэка', async () => {
    const p = fake(['не json', '{"ok":1}']);
    const err = await generateStructured(p, base, Ok, { timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe('invalid-output');
    expect(fallbackReason(err)).toBe('без AI: невалидный ответ модели');
    expect(p.seen).toHaveLength(2);
  });

  it('таймаут → LlmError(timeout)', async () => {
    const err = await generateStructured(fake(['hang']), base, Ok, { timeoutMs: 30 }).catch((e) => e);
    expect(err.kind).toBe('timeout');
    expect(fallbackReason(err)).toBe('без AI: таймаут провайдера');
  });

  it('картинки не уходят провайдеру без поддержки изображений', async () => {
    const p = fake(['{"ok":true}']);
    await generateStructured(p, { ...base, images: [{ mediaType: 'image/png', data: 'x' }] }, Ok, { timeoutMs: 1000 });
    expect(p.seen[0]!.images).toBeUndefined();
  });
});

describe('политика данных', () => {
  const ir: DesignIR = {
    version: 1,
    source: { nodeId: '1', name: 'Promo', width: 100, height: 100 },
    fonts: [],
    root: {
      id: '1',
      name: 'Promo',
      type: 'FRAME',
      visible: true,
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        {
          id: '2',
          name: 'Title',
          type: 'TEXT',
          visible: true,
          bbox: { x: 0, y: 0, width: 100, height: 20 },
          text: { characters: 'Безлимит', fontSize: 20, font: { family: 'A', style: 'B' }, lineHeight: 'AUTO', align: 'LEFT', autoResize: 'HEIGHT', mixed: false },
        },
        {
          id: '3',
          name: 'Button',
          type: 'INSTANCE',
          visible: true,
          bbox: { x: 0, y: 50, width: 100, height: 20 },
          component: { key: 'k', name: 'n', isRemote: true, variantProps: {}, componentProps: { Label: 'Купить', Icon: true }, overriddenNodeIds: [] },
        },
      ],
    },
  };
  const policy = { allowPreview: true, maskTexts: false, confidentialProviders: ['gigachat' as const] };

  it('превью запрещено политикой — не передаётся', () => {
    const out = applyDataPolicy({ ir, preview: 'png' }, { ...policy, allowPreview: false }, 'anthropic');
    expect(out.preview).toBeUndefined();
    expect(applyDataPolicy({ ir, preview: 'png' }, policy, 'anthropic').preview).toBe('png');
  });

  it('маскирование текстов: длина сохраняется, текст — нет', () => {
    const out = applyDataPolicy({ ir }, { ...policy, maskTexts: true }, 'anthropic');
    const json = JSON.stringify(out.ir);
    expect(json).not.toContain('Безлимит');
    expect(json).not.toContain('Купить');
    expect(out.ir.root.children![0]!.text!.characters).toBe(maskText('Безлимит'));
    expect(maskText('Безлимит')).toBe('[текст: 8 симв.]');
    expect(out.ir.root.children![1]!.component!.componentProps.Icon).toBe(true);
    expect(ir.root.children![0]!.text!.characters).toBe('Безлимит'); // исходник не мутирован
  });

  it('конфиденциальный файл — только разрешённые провайдеры', () => {
    expect(() => applyDataPolicy({ ir, confidential: true }, policy, 'anthropic')).toThrow(/не допущен/);
    expect(() => applyDataPolicy({ ir, confidential: true }, policy, 'gigachat')).not.toThrow();
  });
});

describe('лимиты', () => {
  it('не больше N параллельных запросов на пользователя, другие пользователи не ждут', async () => {
    const limiter = new UserLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.run('alice', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    let bobRan = false;
    await Promise.all([task(), task(), task(), task(), task(), limiter.run('bob', async () => void (bobRan = true))]);
    expect(peak).toBe(2);
    expect(bobRan).toBe(true);
  });

  it('учёт токенов на запуск', () => {
    const u = new RunUsage();
    u.add({ inputTokens: 100, outputTokens: 10 });
    u.add({ inputTokens: 50, outputTokens: 5 });
    expect(u.toJSON()).toEqual({ calls: 2, inputTokens: 150, outputTokens: 15 });
  });
});

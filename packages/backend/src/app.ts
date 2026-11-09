import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AdaptationModeSchema, DesignIRSchema, SizePresetSchema } from '@beeline-resize/shared';
import { registerAuth } from './auth.js';
import { ConfigStore, resolveConfigDir } from './config/load.js';
import { REDACT_PATHS, type Settings } from './settings.js';
import { createProvider } from './llm/factory.js';
import { UserLimiter } from './llm/limits.js';
import type { LlmProvider } from './llm/types.js';
import { runAdaptation, type AdaptEvent } from './adapt/run.js';
import { scanLibraries } from './ds/scan.js';
import type { FetchLike } from './llm/types.js';

export interface AppOptions {
  settings: Settings;
  configDir?: string;
  logger?: boolean | { stream: NodeJS.WritableStream };
  /** null — без LLM; undefined — по конфигурации. */
  provider?: LlmProvider | null;
  /** fetch для Figma REST API (тесты). */
  figmaFetch?: FetchLike;
}

export const AdaptBodySchema = z.object({
  ir: DesignIRSchema,
  preview: z.string().optional(),
  targets: z.array(SizePresetSchema).min(1).max(200),
  modeOverrides: z.record(z.string(), AdaptationModeSchema).optional(),
  confidential: z.boolean().optional(),
});
export type AdaptBody = z.infer<typeof AdaptBodySchema>;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-figma-user',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export function buildApp(opts: AppOptions): FastifyInstance {
  const { settings } = opts;
  const loggerOpt = opts.logger ?? false;
  const app = Fastify({
    logger:
      loggerOpt === false
        ? false
        : { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, ...(typeof loggerOpt === 'object' ? { stream: loggerOpt.stream } : {}) },
    bodyLimit: 20 * 1024 * 1024,
  });
  const store = new ConfigStore(resolveConfigDir(opts.configDir));
  const provider = opts.provider === null ? undefined : (opts.provider ?? createProvider(settings));
  const limiter = new UserLimiter(settings.provider.maxConcurrentPerUser);

  // CORS: UI плагина Figma работает в iframe с origin "null"
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return reply.code(204).headers(CORS).send();
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.headers(CORS);
    return payload;
  });

  app.get('/health', async () => ({ status: 'ok' }));
  registerAuth(app, settings.pluginToken);

  /** Конфигурация для плагина: без секретов (spec llm-provider → Credentials stay on backend). */
  app.get('/config', async () => ({
    catalog: await store.catalog(),
    designSystem: (await store.designSystem()) ?? null,
    provider: { name: provider?.name ?? 'none', model: provider?.model ?? '' },
    policy: { allowPreview: settings.policy.allowPreview, maskTexts: settings.policy.maskTexts },
  }));

  /** Адаптация с потоковой выдачей SSE: roles → plan по каждому размеру → done (design D9). */
  app.post('/adapt', async (req, reply) => {
    const parsed = AdaptBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-request', issues: parsed.error.issues.slice(0, 10) });
    }
    const ds = await store.designSystem();
    const ac = new AbortController();
    reply.hijack();
    reply.raw.writeHead(200, {
      ...CORS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ac.abort();
    });
    const send = (e: AdaptEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await runAdaptation(
        parsed.data,
        {
          ...(provider ? { provider } : {}),
          limiter,
          policy: settings.policy,
          timeoutMs: settings.provider.timeoutMs,
          ...(ds ? { ds } : {}),
          user: String(req.headers['x-figma-user'] ?? 'team'),
          signal: ac.signal,
        },
        send,
      );
    } catch (e) {
      req.log.error(e);
      send({ type: 'error', targetId: '*', message: 'внутренняя ошибка адаптации' });
    } finally {
      reply.raw.end();
    }
  });

  /** Скан библиотек Carnica через REST API (spec design-system-integration → Design system mapping config). */
  app.post('/ds/scan', async (_req, reply) => {
    if (!settings.figmaToken) return reply.code(400).send({ error: 'no-figma-token', message: 'FIGMA_TOKEN не задан на бэкенде' });
    const ds = await store.designSystem();
    if (!ds) return reply.code(400).send({ error: 'no-config', message: 'нет config/design-system.json' });
    return { libraries: await scanLibraries(ds, settings.figmaToken, opts.figmaFetch) };
  });

  return app;
}

import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.js';
import { ConfigStore, resolveConfigDir } from './config/load.js';
import { REDACT_PATHS, type Settings } from './settings.js';

export interface AppOptions {
  settings: Settings;
  configDir?: string;
  logger?: boolean | { stream: NodeJS.WritableStream };
}

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

  app.get('/health', async () => ({ status: 'ok' }));
  registerAuth(app, settings.pluginToken);

  /** Конфигурация для плагина: без секретов (spec llm-provider → Credentials stay on backend). */
  app.get('/config', async () => ({
    catalog: await store.catalog(),
    designSystem: (await store.designSystem()) ?? null,
    provider: { name: settings.provider.name, model: settings.provider.model },
    policy: { allowPreview: settings.policy.allowPreview, maskTexts: settings.policy.maskTexts },
  }));

  return app;
}

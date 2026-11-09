import type { Settings } from '../settings.js';
import { AnthropicProvider, type Effort } from './providers/anthropic.js';
import { GigaChatProvider } from './providers/gigachat.js';
import { OpenAiCompatibleProvider, type JsonMode } from './providers/openai-compatible.js';
import { YandexGptProvider } from './providers/yandexgpt.js';
import { LlmError, type FetchLike, type LlmProvider } from './types.js';

export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  'openai-compatible': '',
  gigachat: 'GigaChat-2-Max',
  yandexgpt: 'yandexgpt/latest',
} as const;

/**
 * Провайдер по конфигурации (spec llm-provider → Configurable provider).
 * `none` → undefined: все планы строятся детерминированно.
 */
export function createProvider(settings: Settings, env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): LlmProvider | undefined {
  const { name } = settings.provider;
  const c = settings.credentials;
  const opts = fetchImpl ? { fetch: fetchImpl } : {};
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new LlmError('config', `${name}: не задан ${what}`);
    return v;
  };
  switch (name) {
    case 'none':
      return undefined;
    case 'anthropic':
      return new AnthropicProvider(settings.provider.model || DEFAULT_MODELS.anthropic, need(c.anthropicApiKey, 'ANTHROPIC_API_KEY'), {
        ...opts,
        effort: (env.LLM_EFFORT as Effort | undefined) ?? 'medium',
      });
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(need(settings.provider.model, 'LLM_MODEL'), need(c.openaiBaseUrl, 'OPENAI_COMPATIBLE_BASE_URL'), c.openaiApiKey, {
        ...opts,
        jsonMode: (env.OPENAI_COMPATIBLE_JSON_MODE as JsonMode | undefined) ?? 'json_schema',
        vision: env.OPENAI_COMPATIBLE_VISION === 'true',
      });
    case 'gigachat':
      return new GigaChatProvider(settings.provider.model || DEFAULT_MODELS.gigachat, need(c.gigachatAuthKey, 'GIGACHAT_AUTH_KEY'), {
        ...opts,
        ...(c.gigachatScope ? { scope: c.gigachatScope } : {}),
      });
    case 'yandexgpt':
      return new YandexGptProvider(
        settings.provider.model || DEFAULT_MODELS.yandexgpt,
        need(c.yandexApiKey, 'YANDEXGPT_API_KEY'),
        need(c.yandexFolderId, 'YANDEXGPT_FOLDER_ID'),
        opts,
      );
  }
}

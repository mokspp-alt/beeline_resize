import { z } from 'zod';

export const ProviderNameSchema = z.enum(['anthropic', 'openai-compatible', 'gigachat', 'yandexgpt', 'none']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export interface ProviderCredentials {
  anthropicApiKey?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  gigachatAuthKey?: string;
  gigachatScope?: string;
  yandexApiKey?: string;
  yandexFolderId?: string;
}

export interface DataPolicySettings {
  /** Разрешено ли отправлять растровые превью провайдеру. */
  allowPreview: boolean;
  /** Маскировать тексты макета перед отправкой. */
  maskTexts: boolean;
  /** Провайдеры, допустимые для конфиденциальных файлов. */
  confidentialProviders: ProviderName[];
}

export interface Settings {
  port: number;
  pluginToken: string;
  provider: { name: ProviderName; model: string; timeoutMs: number; maxConcurrentPerUser: number };
  /** Секреты: никогда не отдаются в ответах и не пишутся в логи. */
  credentials: ProviderCredentials;
  policy: DataPolicySettings;
  figmaToken?: string;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Settings {
  const pluginToken = env.PLUGIN_TOKEN ?? '';
  if (!pluginToken) throw new Error('PLUGIN_TOKEN не задан: бэкенд не принимает запросы без авторизации');
  const name = ProviderNameSchema.parse(env.LLM_PROVIDER ?? 'none');
  const confidential = (env.CONFIDENTIAL_PROVIDERS ?? 'openai-compatible,gigachat,yandexgpt')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ProviderNameSchema.parse(s));
  return {
    port: Number(env.PORT ?? 8787),
    pluginToken,
    provider: {
      name,
      model: env.LLM_MODEL ?? '',
      timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 30_000),
      maxConcurrentPerUser: Number(env.LLM_MAX_CONCURRENT_PER_USER ?? 4),
    },
    credentials: {
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiBaseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
      openaiApiKey: env.OPENAI_COMPATIBLE_API_KEY,
      gigachatAuthKey: env.GIGACHAT_AUTH_KEY,
      gigachatScope: env.GIGACHAT_SCOPE,
      yandexApiKey: env.YANDEXGPT_API_KEY,
      yandexFolderId: env.YANDEXGPT_FOLDER_ID,
    },
    policy: {
      allowPreview: bool(env.DATA_ALLOW_PREVIEW, true),
      maskTexts: bool(env.DATA_MASK_TEXTS, false),
      confidentialProviders: confidential,
    },
    figmaToken: env.FIGMA_TOKEN || undefined,
  };
}

/** Пути к секретам — для маскирования в логах Fastify/pino. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'credentials',
  '*.credentials',
  'apiKey',
  '*.apiKey',
];

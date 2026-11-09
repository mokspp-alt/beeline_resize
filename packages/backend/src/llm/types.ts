/** Общий интерфейс LLM-провайдера (design D7). */

export interface LlmImage {
  mediaType: 'image/png';
  /** base64 без префикса data: */
  data: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  images?: LlmImage[];
  /** Имя схемы ответа (для function calling / json_schema). */
  schemaName: string;
  /** JSON Schema ответа: все поля обязательны, необязательные — nullable. */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  signal: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRawResult {
  /** Ответ модели — строка JSON. */
  text: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai-compatible' | 'gigachat' | 'yandexgpt' | 'fake';
  readonly model: string;
  /** Поддерживает ли провайдер растровые изображения во входе. */
  readonly supportsImages: boolean;
  complete(req: LlmRequest): Promise<LlmRawResult>;
}

export type FetchLike = typeof fetch;

/** Ошибки провайдеров приводятся к одному виду, чтобы отчёт мог объяснить фолбэк. */
export class LlmError extends Error {
  constructor(
    readonly kind: 'timeout' | 'invalid-output' | 'refusal' | 'http' | 'config' | 'policy' | 'rate-limit',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Человекочитаемая причина фолбэка для отчёта (spec layout-adaptation → Deterministic fallback). */
export function fallbackReason(e: unknown): string {
  if (e instanceof LlmError) {
    switch (e.kind) {
      case 'timeout':
        return 'без AI: таймаут провайдера';
      case 'invalid-output':
        return 'без AI: невалидный ответ модели';
      case 'refusal':
        return 'без AI: модель отказалась отвечать';
      case 'policy':
        return `без AI: ${e.message}`;
      case 'config':
        return 'без AI: провайдер не настроен';
      case 'rate-limit':
        return 'без AI: превышен лимит запросов';
      case 'http':
        return 'без AI: ошибка провайдера';
    }
  }
  return 'без AI: ошибка провайдера';
}

export async function httpError(res: Response, provider: string): Promise<LlmError> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    // ignore
  }
  return new LlmError(res.status === 429 ? 'rate-limit' : 'http', `${provider}: HTTP ${res.status} ${body}`);
}

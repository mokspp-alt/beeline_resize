import { httpError, type FetchLike, type LlmProvider, type LlmRawResult, type LlmRequest } from '../types.js';

export const YANDEXGPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

/**
 * YandexGPT (Yandex Cloud Foundation Models). Структурированный ответ — параметр jsonSchema.
 * `model` — короткое имя (yandexgpt/latest) или полный URI gpt://<folder>/<model>.
 */
export class YandexGptProvider implements LlmProvider {
  readonly name = 'yandexgpt' as const;
  readonly supportsImages = false;

  constructor(
    readonly model: string,
    private apiKey: string,
    private folderId: string,
    private opts: { fetch?: FetchLike; url?: string } = {},
  ) {}

  get modelUri(): string {
    return this.model.startsWith('gpt://') ? this.model : `gpt://${this.folderId}/${this.model}`;
  }

  async complete(req: LlmRequest): Promise<LlmRawResult> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(this.opts.url ?? YANDEXGPT_URL, {
      method: 'POST',
      signal: req.signal,
      headers: {
        authorization: `Api-Key ${this.apiKey}`,
        'x-folder-id': this.folderId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        modelUri: this.modelUri,
        completionOptions: { stream: false, temperature: 0, maxTokens: String(req.maxTokens) },
        messages: [
          { role: 'system', text: req.system },
          { role: 'user', text: req.user },
        ],
        jsonSchema: { schema: req.jsonSchema },
      }),
    });
    if (!res.ok) throw await httpError(res, 'yandexgpt');
    const data = (await res.json()) as {
      result: {
        alternatives: Array<{ message: { text: string } }>;
        usage?: { inputTextTokens?: string; completionTokens?: string };
      };
    };
    return {
      text: data.result.alternatives[0]?.message.text ?? '',
      usage: {
        inputTokens: Number(data.result.usage?.inputTextTokens ?? 0),
        outputTokens: Number(data.result.usage?.completionTokens ?? 0),
      },
    };
  }
}

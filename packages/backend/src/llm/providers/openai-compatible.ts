import { httpError, type FetchLike, type LlmProvider, type LlmRawResult, type LlmRequest } from '../types.js';

export type JsonMode = 'json_schema' | 'json_object' | 'none';

/**
 * Любой сервер с OpenAI-совместимым Chat Completions API — в том числе модели
 * в контуре компании (vLLM, Ollama, LiteLLM и т.п.).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;
  readonly supportsImages: boolean;

  constructor(
    readonly model: string,
    private baseUrl: string,
    private apiKey: string | undefined,
    private opts: { fetch?: FetchLike; jsonMode?: JsonMode; vision?: boolean } = {},
  ) {
    this.supportsImages = opts.vision ?? false;
  }

  async complete(req: LlmRequest): Promise<LlmRawResult> {
    const f = this.opts.fetch ?? fetch;
    const images = this.supportsImages ? (req.images ?? []) : [];
    const userContent =
      images.length > 0
        ? [
            { type: 'text', text: req.user },
            ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } })),
          ]
        : req.user;

    const mode = this.opts.jsonMode ?? 'json_schema';
    const responseFormat =
      mode === 'json_schema'
        ? { response_format: { type: 'json_schema', json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true } } }
        : mode === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {};
    const system = mode === 'json_schema' ? req.system : `${req.system}\n\nJSON Schema ответа:\n${JSON.stringify(req.jsonSchema)}`;

    const res = await f(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        ...responseFormat,
      }),
    });
    if (!res.ok) throw await httpError(res, 'openai-compatible');
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices[0]?.message.content ?? '',
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type FetchLike, type LlmProvider, type LlmRawResult, type LlmRequest } from '../types.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Claude через официальный SDK. Структурированный ответ — structured outputs
 * (`output_config.format`): принудительный tool_choice на текущих моделях недоступен.
 * Отказы классификаторов перенаправляются на другую модель через `fallbacks: "default"`.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly supportsImages = true;
  private client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
    private opts: { effort?: Effort; fetch?: FetchLike; baseURL?: string } = {},
  ) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: 1,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async complete(req: LlmRequest): Promise<LlmRawResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        }),
      ),
      { type: 'text', text: req.user },
    ];

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content }],
          output_config: {
            effort: this.opts.effort ?? 'medium',
            format: { type: 'json_schema', schema: req.jsonSchema },
          },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: req.signal },
      );
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new LlmError('rate-limit', 'anthropic: 429', e);
      if (e instanceof Anthropic.APIError) throw new LlmError('http', `anthropic: HTTP ${e.status ?? '?'} ${e.message}`, e);
      throw e;
    }

    if (res.stop_reason === 'refusal') {
      throw new LlmError('refusal', `anthropic: отказ (${res.stop_details?.category ?? 'без категории'})`);
    }
    if (res.stop_reason === 'max_tokens') {
      throw new LlmError('invalid-output', 'anthropic: ответ обрезан по max_tokens');
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }
}

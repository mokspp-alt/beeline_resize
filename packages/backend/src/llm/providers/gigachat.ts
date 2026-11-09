import { randomUUID } from 'node:crypto';
import { LlmError, httpError, type FetchLike, type LlmProvider, type LlmRawResult, type LlmRequest } from '../types.js';

export const GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
export const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

/**
 * GigaChat (Сбер). Авторизация: ключ авторизации → access token на 30 минут.
 * Структурированный ответ — через function calling с обязательным вызовом функции.
 * Серверы используют сертификаты НУЦ Минцифры: укажите NODE_EXTRA_CA_CERTS.
 */
export class GigaChatProvider implements LlmProvider {
  readonly name = 'gigachat' as const;
  readonly supportsImages = false;
  private token?: { value: string; expiresAt: number };

  constructor(
    readonly model: string,
    private authKey: string,
    private opts: { scope?: string; fetch?: FetchLike; oauthUrl?: string; apiUrl?: string } = {},
  ) {}

  private get f(): FetchLike {
    return this.opts.fetch ?? fetch;
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const res = await this.f(this.opts.oauthUrl ?? GIGACHAT_OAUTH_URL, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Basic ${this.authKey}`,
        rquid: randomUUID(),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({ scope: this.opts.scope ?? 'GIGACHAT_API_PERS' }).toString(),
    });
    if (!res.ok) throw await httpError(res, 'gigachat oauth');
    const data = (await res.json()) as { access_token: string; expires_at: number };
    this.token = { value: data.access_token, expiresAt: data.expires_at };
    return data.access_token;
  }

  async complete(req: LlmRequest): Promise<LlmRawResult> {
    const token = await this.accessToken(req.signal);
    const res = await this.f(`${this.opts.apiUrl ?? GIGACHAT_API_URL}/chat/completions`, {
      method: 'POST',
      signal: req.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: 0.01,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        functions: [{ name: req.schemaName, description: 'Вернуть результат строго по схеме', parameters: req.jsonSchema }],
        function_call: { name: req.schemaName },
      }),
    });
    if (res.status === 401) this.token = undefined;
    if (!res.ok) throw await httpError(res, 'gigachat');
    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string; function_call?: { name: string; arguments: unknown } } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data.choices[0]?.message;
    if (!msg) throw new LlmError('invalid-output', 'gigachat: пустой ответ');
    const args = msg.function_call?.arguments;
    const text = args === undefined ? (msg.content ?? '') : typeof args === 'string' ? args : JSON.stringify(args);
    return {
      text,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}

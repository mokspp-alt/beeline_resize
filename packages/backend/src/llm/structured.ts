import type { z } from 'zod';
import { LlmError, type LlmProvider, type LlmRequest, type LlmUsage } from './types.js';

export interface StructuredResult<T> {
  value: T;
  usage: LlmUsage;
  attempts: number;
}

/** Достаёт JSON из ответа: снимает ```json-обёртку, берёт внешний объект. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1]! : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('в ответе нет JSON-объекта');
  return JSON.parse(raw.slice(start, end + 1));
}

/** Запрос с таймаутом: при превышении — LlmError('timeout'). */
export async function withTimeout<T>(ms: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new LlmError('timeout', `нет ответа за ${ms} мс`));
  }, ms);
  try {
    return await new Promise<T>((resolve, reject) => {
      ctl.signal.addEventListener('abort', () => reject(timedOut ? new LlmError('timeout', `нет ответа за ${ms} мс`) : ctl.signal.reason), {
        once: true,
      });
      run(ctl.signal).then(resolve, reject);
    });
  } catch (e) {
    if (timedOut) throw new LlmError('timeout', `нет ответа за ${ms} мс`, e);
    throw e;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
}

/**
 * Запрос со структурированным ответом (spec llm-provider → Structured output):
 * проверка по схеме, одна повторная попытка с описанием ошибки, затем LlmError('invalid-output').
 */
export async function generateStructured<S extends z.ZodType>(
  provider: LlmProvider,
  req: Omit<LlmRequest, 'signal'>,
  schema: S,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<StructuredResult<z.infer<S>>> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let user = req.user;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await withTimeout(opts.timeoutMs, opts.signal, (signal) =>
      provider.complete({ ...req, user, ...(provider.supportsImages ? {} : { images: undefined }), signal }),
    );
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    try {
      const parsed = schema.safeParse(extractJson(res.text));
      if (parsed.success) return { value: parsed.data, usage, attempts: attempt };
      lastError = parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
        .join('; ');
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    user = `${req.user}\n\nПредыдущий ответ не прошёл проверку схемы: ${lastError}\nВерни только JSON строго по схеме.`;
  }
  throw new LlmError('invalid-output', `ответ не прошёл схему после повтора: ${lastError}`);
}

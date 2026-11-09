import type { DesignIR, DesignNode } from '@beeline-resize/shared';
import type { DataPolicySettings } from '../settings.js';
import { LlmError } from './types.js';

export interface PolicyInput {
  ir: DesignIR;
  preview?: string;
  /** Файл помечен пользователем как конфиденциальный. */
  confidential?: boolean;
}

export interface PolicyOutput {
  ir: DesignIR;
  preview?: string;
}

/** Плейсхолдер вместо текста: длина сохраняется, содержимое — нет. */
export function maskText(s: string): string {
  return `[текст: ${[...s].length} симв.]`;
}

function maskNode(n: DesignNode): DesignNode {
  const out: DesignNode = { ...n };
  if (n.text) out.text = { ...n.text, characters: maskText(n.text.characters) };
  if (n.component) {
    out.component = {
      ...n.component,
      componentProps: Object.fromEntries(
        Object.entries(n.component.componentProps).map(([k, v]) => [k, typeof v === 'string' ? maskText(v) : v]),
      ),
    };
  }
  if (n.children) out.children = n.children.map(maskNode);
  return out;
}

/**
 * Применяет политику данных до отправки провайдеру (spec llm-provider → Data policy).
 * Нарушающий политику запрос не отправляется: LlmError('policy').
 */
export function applyDataPolicy(input: PolicyInput, policy: DataPolicySettings, providerName: string): PolicyOutput {
  if (input.confidential && !policy.confidentialProviders.includes(providerName as never)) {
    throw new LlmError('policy', `провайдер ${providerName} не допущен для конфиденциальных файлов`);
  }
  const ir = policy.maskTexts ? { ...input.ir, root: maskNode(input.ir.root) } : input.ir;
  return policy.allowPreview && input.preview ? { ir, preview: input.preview } : { ir };
}

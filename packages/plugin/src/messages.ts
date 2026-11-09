import type { DesignIR } from '@beeline-resize/shared';
import type { SourceWarning } from './capture/warnings.js';

/** Протокол сообщений main ↔ ui. */

export interface SelectionInfo {
  ok: boolean;
  message?: string;
  source?: { id: string; name: string; width: number; height: number };
  suggestionId?: string;
}

export type MainToUi =
  | { type: 'selection'; selection: SelectionInfo }
  | { type: 'captured'; ir: DesignIR; preview?: string; warnings: SourceWarning[] }
  | { type: 'capture-error'; message: string };

export type UiToMain =
  | { type: 'select-node'; nodeId: string }
  | { type: 'capture'; allowPreview: boolean };

import type { ReportItem, SizePreset } from '@beeline-resize/shared';

/** Состояние прогресса по размерам (spec figma-output-generation → Progress and cancellation). */
export type TargetStatus = 'queued' | 'processing' | 'done' | 'error' | 'cancelled';

export interface TargetRow {
  preset: SizePreset;
  status: TargetStatus;
  frameId?: string;
  name?: string;
  ai?: boolean;
  fallbackReason?: string;
  report: ReportItem[];
  error?: string;
}

export type ProgressAction =
  | { type: 'start'; presets: SizePreset[] }
  | { type: 'roles' }
  | { type: 'planned'; targetId: string; ai: boolean; fallbackReason?: string }
  | { type: 'applied'; targetId: string; frameId: string; name: string; report: ReportItem[] }
  | { type: 'error'; targetId: string; message: string }
  | { type: 'cancel' }
  | { type: 'finish' };

export function progress(rows: TargetRow[], a: ProgressAction): TargetRow[] {
  const upd = (id: string, f: (r: TargetRow) => TargetRow) => rows.map((r) => (r.preset.id === id || id === '*' ? f(r) : r));
  switch (a.type) {
    case 'start':
      return a.presets.map((preset) => ({ preset, status: 'queued', report: [] }));
    case 'roles':
      return rows.map((r) => (r.status === 'queued' ? { ...r, status: 'processing' } : r));
    case 'planned':
      return upd(a.targetId, (r) => ({ ...r, status: 'processing', ai: a.ai, ...(a.fallbackReason ? { fallbackReason: a.fallbackReason } : {}) }));
    case 'applied':
      return upd(a.targetId, (r) => ({ ...r, status: 'done', frameId: a.frameId, name: a.name, report: a.report }));
    case 'error':
      return upd(a.targetId, (r) => (r.status === 'done' ? r : { ...r, status: 'error', error: a.message }));
    case 'cancel':
    case 'finish':
      return rows.map((r) => (r.status === 'queued' || r.status === 'processing' ? { ...r, status: a.type === 'cancel' ? 'cancelled' : 'error', ...(a.type === 'finish' ? { error: 'план не получен' } : {}) } : r));
  }
}

export function isRunning(rows: TargetRow[]): boolean {
  return rows.some((r) => r.status === 'queued' || r.status === 'processing');
}

const KIND_LABEL: Record<ReportItem['kind'], string> = {
  fallback: 'Без AI',
  hidden: 'Скрыто',
  'no-token': 'Нет токена',
  'no-app-analog': 'Нет аналога',
  overflow: 'Переполнение',
  'library-missing': 'Библиотека',
  warning: 'Предупреждение',
  error: 'Ошибка',
};

export function kindLabel(k: ReportItem['kind']): string {
  return KIND_LABEL[k];
}

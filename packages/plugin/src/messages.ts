import type { DesignIR, DesignSystemConfig, LayoutPlan, ReportItem, ScanCollection, SizePreset } from '@beeline-resize/shared';
import type { SourceWarning } from './capture/warnings.js';
import type { DsSummary, LibraryStatus } from './ds/library.js';
import type { Applied, TargetInfo } from './run/session.js';

/** Протокол сообщений main ↔ ui. */

export interface SelectionInfo {
  ok: boolean;
  message?: string;
  source?: { id: string; name: string; width: number; height: number };
  suggestionId?: string;
}

export type SavedSets = Record<string, SizePreset[]>;

export type MainToUi =
  | { type: 'init'; token: string; sets: SavedSets; userId: string }
  | { type: 'selection'; selection: SelectionInfo }
  | { type: 'captured'; ir: DesignIR; preview?: string; warnings: SourceWarning[] }
  | { type: 'capture-error'; message: string }
  | { type: 'ds-status'; statuses: LibraryStatus[]; summary: DsSummary }
  | { type: 'applied'; applied: Applied }
  | { type: 'apply-error'; targetId: string; message: string }
  | { type: 'run-finished'; count: number }
  | { type: 'scan-collections'; collections: ScanCollection[] }
  | { type: 'scan-error'; message: string };

export type UiToMain =
  | { type: 'init' }
  | { type: 'save-token'; token: string }
  | { type: 'save-sets'; sets: SavedSets }
  | { type: 'select-node'; nodeId: string }
  | { type: 'capture'; allowPreview: boolean }
  | { type: 'ds-status'; ds: DesignSystemConfig }
  | { type: 'run-start'; targets: TargetInfo[]; ds: DesignSystemConfig | null; regenerate: boolean }
  | { type: 'apply-plan'; plan: LayoutPlan; report: ReportItem[] }
  | { type: 'run-cancel' }
  | { type: 'run-finish' }
  | { type: 'scan-collections'; libraryNames: string[] };

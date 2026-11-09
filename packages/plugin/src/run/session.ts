import type { DesignSystemConfig, LayoutPlan, ReportItem } from '@beeline-resize/shared';
import type { PresetGroup } from '@beeline-resize/shared/labels';
import type { ApplyResult } from '../apply/apply.js';
import { fingerprint, type FpNode } from '../apply/fingerprint.js';
import { nextVersionName, resultName } from '../apply/naming.js';
import { GAP, placeResults, type Box } from '../apply/placement.js';

/**
 * Сессия запуска адаптации в main (spec figma-output-generation):
 * планы применяются по мере прихода, размещение — в конце, отмена сохраняет созданное,
 * весь запуск — один шаг Undo.
 */

export const DATA_KEY = 'beeline-resize';

export interface ResultMeta {
  sourceId: string;
  targetId: string;
  fp: string;
}

export interface TargetInfo {
  id: string;
  group: PresetGroup;
  name: string;
  width: number;
  height: number | 'auto';
}

type Frame = FrameNode;
type Source = FrameNode | ComponentNode | InstanceNode;

export interface SessionDeps {
  source: Source;
  /** Верхнеуровневые узлы текущей страницы. */
  pageNodes(): readonly SceneNode[];
  apply(plan: LayoutPlan, report: ReportItem[]): Promise<ApplyResult>;
  commitUndo(): void;
  ds?: DesignSystemConfig;
}

export interface Applied {
  targetId: string;
  frameId: string;
  name: string;
  report: ReportItem[];
  regenerated?: 'replaced' | 'versioned';
}

const box = (n: { x: number; y: number; width: number; height: number }): Box => ({ x: n.x, y: n.y, width: n.width, height: n.height });

export function readMeta(n: { getPluginData(k: string): string }): ResultMeta | undefined {
  try {
    const raw = n.getPluginData(DATA_KEY);
    return raw ? (JSON.parse(raw) as ResultMeta) : undefined;
  } catch {
    return undefined;
  }
}

export class RunSession {
  private created: Array<{ frame: Frame; target: TargetInfo }> = [];
  private cancelled = false;
  private finished = false;

  constructor(
    private deps: SessionDeps,
    private targets: Map<string, TargetInfo>,
    /** Перегенерация одного размера. */
    private regenerate = false,
  ) {
    // всё, что было до запуска, — отдельный шаг Undo
    deps.commitUndo();
  }

  get isCancelled() {
    return this.cancelled;
  }

  async onPlan(plan: LayoutPlan, report: ReportItem[]): Promise<Applied | undefined> {
    if (this.cancelled || this.finished) return undefined;
    const target = this.targets.get(plan.targetId);
    if (!target) return undefined;
    const { frame, report: rep } = await this.deps.apply(plan, report);
    frame.name = resultName(this.deps.source.name, target);
    let regenerated: Applied['regenerated'];

    if (this.regenerate) {
      const prev = this.findPrevious(plan.targetId);
      if (prev) {
        const meta = readMeta(prev)!;
        if (fingerprint(prev as unknown as FpNode) === meta.fp) {
          frame.x = prev.x;
          frame.y = prev.y;
          frame.name = prev.name;
          prev.remove();
          regenerated = 'replaced';
        } else {
          const names = this.deps.pageNodes().map((n) => n.name);
          frame.name = nextVersionName(prev.name, names);
          const spot = placeResults(box(prev), [{ group: target.group, width: frame.width, height: frame.height }], this.occupied([frame]))[0]!;
          frame.x = spot.x;
          frame.y = spot.y;
          regenerated = 'versioned';
        }
        this.stamp(frame, plan.targetId);
      }
    }
    this.created.push({ frame, target });
    return { targetId: plan.targetId, frameId: frame.id, name: frame.name, report: rep, ...(regenerated ? { regenerated } : {}) };
  }

  /** Отмена: дальнейшие планы игнорируются, созданные фреймы остаются. */
  cancel() {
    this.cancelled = true;
  }

  /** Размещение новых результатов и фиксация шага Undo. */
  finish(): Frame[] {
    if (this.finished) return this.created.map((c) => c.frame);
    this.finished = true;
    const fresh = this.created.filter((c) => !readMeta(c.frame));
    if (fresh.length > 0) {
      const spots = placeResults(
        box(this.deps.source),
        fresh.map((c) => ({ c, group: c.target.group, width: c.frame.width, height: c.frame.height })),
        this.occupied(fresh.map((c) => c.frame)),
      );
      for (const s of spots) {
        s.c.frame.x = s.x;
        s.c.frame.y = s.y;
        this.stamp(s.c.frame, s.c.target.id);
      }
    }
    this.deps.commitUndo();
    return this.created.map((c) => c.frame);
  }

  private stamp(frame: Frame, targetId: string) {
    const meta: ResultMeta = { sourceId: this.deps.source.id, targetId, fp: fingerprint(frame as unknown as FpNode) };
    frame.setPluginData(DATA_KEY, JSON.stringify(meta));
  }

  private findPrevious(targetId: string): Frame | undefined {
    const created = new Set(this.created.map((c) => c.frame));
    return [...this.deps.pageNodes()]
      .reverse()
      .find((n) => {
        if (created.has(n as Frame)) return false;
        const m = readMeta(n as Frame);
        return m?.sourceId === this.deps.source.id && m.targetId === targetId;
      }) as Frame | undefined;
  }

  private occupied(exclude: Frame[]): Box[] {
    const ex = new Set<unknown>(exclude);
    return this.deps
      .pageNodes()
      .filter((n) => !ex.has(n) && n.visible !== false)
      .map((n) => box(n as Frame));
  }
}

export { GAP };

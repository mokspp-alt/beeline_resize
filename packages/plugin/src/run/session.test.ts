import { describe, expect, it } from 'vitest';
import type { LayoutPlan } from '@beeline-resize/shared';
import { RunSession, readMeta, type TargetInfo } from './session.js';
import { intersects } from '../apply/placement.js';
import { FNode, page } from '../test/fake-scene.js';

function setup(extra: FNode[] = []) {
  const title = new FNode('TEXT', 'Title', { characters: 'Привет', width: 300, height: 40 });
  const source = new FNode('FRAME', 'Promo', { x: 0, y: 0, width: 1080, height: 1080 }, [title]);
  const pg = page(source, ...extra);
  let undo = 0;
  const targets = new Map<string, TargetInfo>([
    ['banner-display:300x250', { id: 'banner-display:300x250', group: 'banner-display', name: 'Medium Rectangle 300×250', width: 300, height: 250 }],
    ['banner-display:728x90', { id: 'banner-display:728x90', group: 'banner-display', name: 'Leaderboard 728×90', width: 728, height: 90 }],
    ['app-ios:393x852', { id: 'app-ios:393x852', group: 'app-ios', name: 'iPhone 16', width: 393, height: 852 }],
  ]);
  const deps = {
    source: source as unknown as FrameNode,
    pageNodes: () => pg.children as unknown as SceneNode[],
    apply: async (plan: LayoutPlan) => {
      const f = source.clone();
      f.resize(plan.width, plan.height === 'auto' ? 1080 : plan.height);
      return { frame: f as unknown as FrameNode, report: [], nodeMap: new Map() };
    },
    commitUndo: () => void undo++,
  };
  return { source, pg, deps, targets, undoCount: () => undo };
}

const plan = (targetId: string, width: number, height: number): LayoutPlan => ({
  targetId,
  width,
  height,
  mode: 'banner',
  sizeClass: 'x',
  composition: 'stack',
  variableModes: {},
  operations: [],
  ai: true,
});

describe('8.2–8.5 сессия запуска', () => {
  it('имена, размещение без перекрытий, метаданные, один шаг Undo', async () => {
    const other = new FNode('FRAME', 'Чужой фрейм', { x: 1200, y: 0, width: 500, height: 500 });
    const { deps, targets, pg, undoCount } = setup([other]);
    const s = new RunSession(deps, targets);
    expect(undoCount()).toBe(1); // отделили предыдущие действия
    await s.onPlan(plan('banner-display:300x250', 300, 250), []);
    await s.onPlan(plan('app-ios:393x852', 393, 852), []);
    expect(undoCount()).toBe(1); // между фреймами шаг не фиксируется
    const frames = s.finish();
    expect(undoCount()).toBe(2);
    expect(frames.map((f) => f.name)).toEqual(['Promo / Баннеры / Medium Rectangle 300×250', 'Promo / App iOS / iPhone 16 393×852']);
    for (const f of frames) {
      expect(intersects(f, other)).toBe(false);
      expect(readMeta(f as unknown as FNode)).toMatchObject({ sourceId: deps.source.id });
    }
    expect(pg.children).toHaveLength(4);
  });

  it('отмена: дальнейшие планы игнорируются, созданное остаётся', async () => {
    const { deps, targets, pg } = setup();
    const s = new RunSession(deps, targets);
    await s.onPlan(plan('banner-display:300x250', 300, 250), []);
    s.cancel();
    expect(await s.onPlan(plan('banner-display:728x90', 728, 90), [])).toBeUndefined();
    s.finish();
    expect(pg.children.filter((c) => c.name.startsWith('Promo /'))).toHaveLength(1);
  });

  it('перегенерация нетронутого результата: замена на том же месте', async () => {
    const { deps, targets, pg } = setup();
    const first = new RunSession(deps, targets);
    await first.onPlan(plan('banner-display:300x250', 300, 250), []);
    const [old] = first.finish();
    const pos = { x: old!.x, y: old!.y };

    const again = new RunSession(deps, targets, true);
    const r = await again.onPlan(plan('banner-display:300x250', 300, 250), []);
    again.finish();
    expect(r!.regenerated).toBe('replaced');
    const results = pg.children.filter((c) => c.name.startsWith('Promo /'));
    expect(results).toHaveLength(1);
    expect({ x: results[0]!.x, y: results[0]!.y }).toEqual(pos);
    expect(results[0]).not.toBe(old);
  });

  it('перегенерация изменённого вручную: старый сохранён, новый рядом с «v2»', async () => {
    const { deps, targets, pg } = setup();
    const first = new RunSession(deps, targets);
    await first.onPlan(plan('banner-display:300x250', 300, 250), []);
    const [old] = first.finish() as unknown as FNode[];
    old!.children[0]!.characters = 'Правка дизайнера';

    const again = new RunSession(deps, targets, true);
    const r = await again.onPlan(plan('banner-display:300x250', 300, 250), []);
    again.finish();
    expect(r!.regenerated).toBe('versioned');
    const results = pg.children.filter((c) => c.name.startsWith('Promo /'));
    expect(results.map((c) => c.name)).toEqual(['Promo / Баннеры / Medium Rectangle 300×250', 'Promo / Баннеры / Medium Rectangle 300×250 v2']);
    expect(results[0]).toBe(old);
    expect(intersects(results[0]!, results[1]!)).toBe(false);
  });
});

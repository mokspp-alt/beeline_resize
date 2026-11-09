import type { Rect } from '@beeline-resize/shared';
import { isFullBleed } from './roles.js';
import type { SolveInput, SolveResult } from './solver.js';

/**
 * Проверка итоговой геометрии (spec layout-adaptation → Plan validation):
 * элементы внутри кадра, значимые элементы не перекрываются (кроме текста на фоне),
 * в App контент не заходит в верхнюю safe area.
 */
export function validateGeometry(input: SolveInput, result: SolveResult): string[] {
  const errors: string[] = [];
  const { preset, mode, ir, roles, template } = input;
  if (mode === 'web') return errors; // высота по содержимому, раскладку делает auto layout
  const W = preset.width;
  const H = preset.height === 'auto' ? Infinity : preset.height;
  const byId = new Map<string, import('@beeline-resize/shared').DesignNode>();
  const idx = (n: import('@beeline-resize/shared').DesignNode) => {
    byId.set(n.id, n);
    n.children?.forEach(idx);
  };
  idx(ir.root);

  const layered = (id: string) => {
    const role = roles.roles[id]?.role;
    const n = byId.get(id);
    return role === 'background' || (n && isFullBleed(n, ir)) || (role === 'hero-image' && template.composition === 'overlay');
  };

  const boxes = [...result.boxes.entries()].filter(([id]) => !result.hidden.has(id));
  for (const [id, b] of boxes) {
    if (b.x < -1 || b.y < -1 || b.x + b.width > W + 1 || (mode === 'banner' && b.y + b.height > H + 1)) {
      errors.push(`${id} выходит за границы кадра`);
    }
  }

  const solid = boxes.filter(([id]) => !layered(id));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlap(solid[i]![1], solid[j]![1]) > 1) errors.push(`${solid[i]![0]} перекрывает ${solid[j]![0]}`);
    }
  }

  if (mode === 'app' && preset.safeArea) {
    for (const [id, b] of solid) {
      const role = roles.roles[id]?.role;
      if (role === 'status-bar') continue;
      if (b.y < preset.safeArea.top - 1) errors.push(`${id} заходит в верхнюю safe area`);
    }
  }
  return errors;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

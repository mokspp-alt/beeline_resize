import type { PresetGroup } from '@beeline-resize/shared/labels';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GAP = 100;
const GROUP_ORDER: PresetGroup[] = ['web', 'app-ios', 'app-android', 'banner-display', 'banner-social', 'custom'];

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Раскладка результатов справа от исходника рядами по группам с отступом 100
 * в ближайшей свободной области (не перекрывая существующие объекты).
 */
export function placeResults<T extends { group: PresetGroup; width: number; height: number }>(
  source: Box,
  items: T[],
  occupied: Box[],
): Array<T & { x: number; y: number }> {
  const rows = GROUP_ORDER.map((g) => items.filter((i) => i.group === g)).filter((r) => r.length > 0);
  // относительные позиции внутри блока
  const rel: Array<T & { x: number; y: number }> = [];
  let y = 0;
  let blockW = 0;
  for (const row of rows) {
    let x = 0;
    let rowH = 0;
    for (const it of row) {
      rel.push({ ...it, x, y });
      x += it.width + GAP;
      rowH = Math.max(rowH, it.height);
    }
    blockW = Math.max(blockW, x - GAP);
    y += rowH + GAP;
  }
  const blockH = Math.max(0, y - GAP);

  // ищем свободное место: начинаем справа от исходника, сдвигаемся вниз под мешающие объекты
  const ox = source.x + source.width + GAP;
  let oy = source.y;
  for (let guard = 0; guard < 1000; guard++) {
    const block = { x: ox, y: oy, width: blockW, height: blockH };
    const hits = occupied.filter((o) => intersects(block, expand(o, GAP / 2)));
    if (hits.length === 0) break;
    oy = Math.max(...hits.map((h) => h.y + h.height)) + GAP;
  }
  return rel.map((r) => ({ ...r, x: r.x + ox, y: r.y + oy }));
}

function expand(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d };
}

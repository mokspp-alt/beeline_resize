/**
 * Отпечаток результата для проверки «изменён вручную» (spec figma-output-generation → Regeneration).
 * Позиция самого фрейма на холсте не учитывается — его можно двигать.
 */
export interface FpNode {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  characters?: string;
  children?: readonly FpNode[];
}

export function fingerprint(root: FpNode): string {
  const parts: string[] = [];
  const visit = (n: FpNode, isRoot: boolean) => {
    parts.push(
      [n.type, n.name, isRoot ? 0 : Math.round(n.x), isRoot ? 0 : Math.round(n.y), Math.round(n.width), Math.round(n.height), n.visible ? 1 : 0, n.characters ?? ''].join('|'),
    );
    for (const c of n.children ?? []) visit(c, false);
  };
  visit(root, true);
  return fnv1a(parts.join('\n'));
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

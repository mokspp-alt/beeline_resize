/**
 * Проверка выделения (spec figma-source-capture → Single source frame selection).
 * Работает с «утиными» узлами, чтобы тестироваться без Figma.
 */

export interface NodeLike {
  id: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
  parent: NodeLike | null;
}

const SOURCE_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);
const TOP_LEVEL_PARENTS = new Set(['PAGE', 'SECTION']);

export type SelectionCheck<N extends NodeLike = NodeLike> =
  | { ok: true; node: N }
  | { ok: false; code: 'empty' | 'multiple'; message: string }
  | { ok: false; code: 'not-frame'; message: string; suggestion?: N };

export const SELECTION_MESSAGE = 'Выберите один фрейм-исходник';

function isTopLevel(node: NodeLike): boolean {
  return node.parent !== null && TOP_LEVEL_PARENTS.has(node.parent.type);
}

/** Ближайший фрейм верхнего уровня среди предков. */
export function topLevelFrameOf<N extends NodeLike>(node: N): N | undefined {
  let cur: NodeLike | null = node.parent;
  while (cur) {
    if (SOURCE_TYPES.has(cur.type) && isTopLevel(cur)) return cur as N;
    cur = cur.parent;
  }
  return undefined;
}

export function checkSelection<N extends NodeLike>(selection: readonly N[]): SelectionCheck<N> {
  if (selection.length === 0) return { ok: false, code: 'empty', message: SELECTION_MESSAGE };
  if (selection.length > 1) return { ok: false, code: 'multiple', message: SELECTION_MESSAGE };
  const node = selection[0]!;
  if (SOURCE_TYPES.has(node.type) && isTopLevel(node)) return { ok: true, node };

  const suggestion = topLevelFrameOf(node);
  return {
    ok: false,
    code: 'not-frame',
    message: suggestion
      ? `Выделен слой «${node.name}». Выберите родительский фрейм «${suggestion.name}».`
      : `Выделен слой «${node.name}». ${SELECTION_MESSAGE} верхнего уровня.`,
    suggestion,
  };
}

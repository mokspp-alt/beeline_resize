/**
 * Минимальные фейки узлов Figma для тестов: только свойства, которые читает плагин.
 */
export const MIXED = Symbol('mixed');

type Props = Record<string, unknown>;

export interface FakeNode extends Props {
  id: string;
  name: string;
  type: string;
  parent: FakeNode | null;
  children?: FakeNode[];
}

let seq = 0;

export function node(type: string, props: Props = {}, children?: FakeNode[]): FakeNode {
  const n: FakeNode = {
    id: (props.id as string) ?? `n:${++seq}`,
    name: (props.name as string) ?? type,
    type,
    parent: null,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...props,
  };
  if (children) {
    n.children = children;
    for (const c of children) c.parent = n;
  }
  return n;
}

/** Проставляет absoluteBoundingBox по x/y относительно родителей. */
export function layout(root: FakeNode, ox = 0, oy = 0): FakeNode {
  const x = ox + (root.x as number);
  const y = oy + (root.y as number);
  root.absoluteBoundingBox = { x, y, width: root.width, height: root.height };
  for (const c of root.children ?? []) layout(c, x, y);
  return root;
}

export function page(children: FakeNode[]): FakeNode {
  return node('PAGE', { name: 'Page 1' }, children);
}

export function text(chars: string, props: Props = {}): FakeNode {
  return node('TEXT', {
    characters: chars,
    fontSize: 16,
    fontName: { family: 'Beeline Sans', style: 'Regular' },
    lineHeight: { unit: 'AUTO' },
    textAlignHorizontal: 'LEFT',
    textAutoResize: 'HEIGHT',
    textStyleId: '',
    hasMissingFont: false,
    fills: [],
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    ...props,
  });
}

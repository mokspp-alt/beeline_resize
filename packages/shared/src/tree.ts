import type { DesignNode } from './ir.js';

/** Обход дерева в глубину. */
export function walk(node: DesignNode, visit: (n: DesignNode, parent: DesignNode | null) => void, parent: DesignNode | null = null): void {
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
}

/** Индекс узлов по id. */
export function indexNodes(root: DesignNode): Map<string, DesignNode> {
  const map = new Map<string, DesignNode>();
  walk(root, (n) => map.set(n.id, n));
  return map;
}

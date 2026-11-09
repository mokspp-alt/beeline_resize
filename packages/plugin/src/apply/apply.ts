import type { DesignSystemConfig, LayoutPlan, Operation, ReportItem } from '@beeline-resize/shared';
import { textStyleFor } from '@beeline-resize/shared/ds-rules';
import { cropTransform } from './crop.js';

/**
 * Применение плана (design D4): clone → resize → моды переменных → варианты/замены → операции плана.
 * Исходник не меняется. Все обращения к Figma, кроме операций над узлами, — через ApplyDeps.
 */

export interface ApplyDeps {
  mixed: symbol;
  loadFont(font: FontName): Promise<void>;
  /** Ключ компонента или набора компонентов → компонент (для набора — вариант по умолчанию). */
  importComponent(key: string): Promise<ComponentNode>;
  importVariable(key: string): Promise<Variable>;
  /** Ключ библиотечной коллекции → коллекция с модами. */
  collectionForKey(key: string): Promise<VariableCollection | null>;
  importStyle(key: string): Promise<BaseStyle>;
  imageSize(hash: string): Promise<{ width: number; height: number } | null>;
}

export interface ApplyResult {
  frame: FrameNode;
  /** Отчёт бэкенда + предупреждения применения; nodeId переведены в id узлов результата. */
  report: ReportItem[];
  nodeMap: Map<string, SceneNode>;
}

type Source = FrameNode | ComponentNode | InstanceNode;
type AnyNode = SceneNode & Record<string, any>;

/** Сопоставление id исходника → узлы клона (структура одинаковая). */
export function mapNodes(src: SceneNode, clone: SceneNode, map = new Map<string, SceneNode>()): Map<string, SceneNode> {
  map.set(src.id, clone);
  const a = 'children' in src ? src.children : [];
  const b = 'children' in clone ? clone.children : [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) mapNodes(a[i]!, b[i]!, map);
  return map;
}

function makeFrame(source: Source): FrameNode {
  if (source.type === 'COMPONENT') return source.createInstance().detachInstance();
  if (source.type === 'INSTANCE') return source.clone().detachInstance();
  return source.clone();
}

const DS_FIRST: Operation['op'][] = ['swapComponent', 'swapVariant'];

export async function applyPlan(source: Source, plan: LayoutPlan, report: ReportItem[], ds: DesignSystemConfig | undefined, deps: ApplyDeps): Promise<ApplyResult> {
  const frame = makeFrame(source);
  const nodeMap = mapNodes(source, frame);
  const out: ReportItem[] = [];
  const warn = (message: string, nodeId?: string) =>
    out.push({ targetId: plan.targetId, kind: 'warning', message, ...(nodeId ? { nodeId } : {}) });
  const loaded = new Set<string>();

  const ensureFonts = async (n: AnyNode) => {
    const texts: TextNode[] = [];
    const collect = (x: AnyNode) => {
      if (x.type === 'TEXT') texts.push(x as unknown as TextNode);
      if ('children' in x) (x.children as AnyNode[]).forEach(collect);
    };
    collect(n);
    for (const t of texts) {
      const fonts = t.fontName === deps.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName as FontName];
      for (const f of fonts) {
        const k = `${f.family}::${f.style}`;
        if (!loaded.has(k)) {
          await deps.loadFont(f);
          loaded.add(k);
        }
      }
    }
  };

  // 1. Размер кадра
  const height = plan.height === 'auto' ? source.height : plan.height;
  frame.resize(plan.width, height);
  if (plan.mode !== 'web') frame.clipsContent = true;

  // 2. Моды переменных Carnica (брейкпоинт, платформа)
  for (const [collectionKey, modeName] of Object.entries(plan.variableModes)) {
    try {
      const collection = await deps.collectionForKey(collectionKey);
      const mode = collection?.modes.find((m) => m.name === modeName);
      if (!collection || !mode) {
        out.push({ targetId: plan.targetId, kind: 'library-missing', message: `мод «${modeName}» не найден: библиотека не включена или коллекция изменилась` });
        continue;
      }
      frame.setExplicitVariableModeForCollection(collection, mode.modeId);
    } catch (e) {
      warn(`мод «${modeName}» не установлен: ${msg(e)}`);
    }
  }

  // 3–4. Сначала операции ДС (варианты/замены), затем раскладка в порядке плана
  const ops = [...plan.operations.filter((o) => DS_FIRST.includes(o.op)), ...plan.operations.filter((o) => !DS_FIRST.includes(o.op))];
  for (const op of ops) {
    const node = nodeMap.get(op.nodeId) as AnyNode | undefined;
    if (!node) {
      warn(`узел ${op.nodeId} не найден в результате`);
      continue;
    }
    try {
      await applyOp(op, node, { frame, nodeMap, ds, deps, ensureFonts, out, plan });
    } catch (e) {
      warn(`${op.op} для «${node.name}» не применена: ${msg(e)}`, node.id);
    }
  }

  // 5. Высота по содержимому для web
  if (plan.height === 'auto' && frame.layoutMode === 'VERTICAL') frame.primaryAxisSizingMode = 'AUTO';

  const translated = [...report, ...out].map((r) => {
    if (!r.nodeId) return r;
    const n = nodeMap.get(r.nodeId);
    return n ? { ...r, nodeId: n.id } : r;
  });
  return { frame, report: translated, nodeMap };
}

interface OpCtx {
  frame: FrameNode;
  nodeMap: Map<string, SceneNode>;
  ds: DesignSystemConfig | undefined;
  deps: ApplyDeps;
  ensureFonts(n: AnyNode): Promise<void>;
  out: ReportItem[];
  plan: LayoutPlan;
}

async function applyOp(op: Operation, node: AnyNode, c: OpCtx): Promise<void> {
  switch (op.op) {
    case 'hide':
      node.visible = false;
      return;
    case 'show':
      node.visible = true;
      return;
    case 'setLayout': {
      if (!('layoutMode' in node)) throw new Error('узел не поддерживает auto layout');
      node.layoutMode = op.mode;
      if (op.mode === 'NONE') return;
      if (op.wrap !== undefined && op.mode === 'HORIZONTAL') node.layoutWrap = op.wrap ? 'WRAP' : 'NO_WRAP';
      if (op.itemSpacing !== undefined) node.itemSpacing = op.itemSpacing;
      if (op.padding) {
        node.paddingTop = op.padding.top;
        node.paddingRight = op.padding.right;
        node.paddingBottom = op.padding.bottom;
        node.paddingLeft = op.padding.left;
      }
      if (op.primaryAxisAlign) node.primaryAxisAlignItems = op.primaryAxisAlign;
      if (op.counterAxisAlign) node.counterAxisAlignItems = op.counterAxisAlign;
      return;
    }
    case 'setGrid': {
      node.layoutMode = 'HORIZONTAL';
      node.layoutWrap = 'WRAP';
      node.itemSpacing = op.gap;
      node.counterAxisSpacing = op.gap;
      const inner = node.width - (node.paddingLeft ?? 0) - (node.paddingRight ?? 0);
      const cw = Math.floor((inner - op.gap * (op.columns - 1)) / op.columns);
      for (const child of node.children as AnyNode[]) {
        if (child.layoutPositioning === 'ABSOLUTE') continue;
        child.layoutSizingHorizontal = 'FIXED';
        child.resize(cw, child.height);
      }
      return;
    }
    case 'reorder': {
      op.order.forEach((id, i) => {
        const child = c.nodeMap.get(id);
        if (child && child.parent === node) node.insertChild(i, child);
      });
      return;
    }
    case 'setSize': {
      if (op.width !== undefined || op.height !== undefined) {
        if (node.type === 'TEXT') {
          await c.ensureFonts(node);
          node.resize(op.width ?? node.width, node.height);
          node.textAutoResize = 'HEIGHT';
        } else {
          node.resize(op.width ?? node.width, op.height ?? node.height);
        }
      }
      if (op.sizingH) node.layoutSizingHorizontal = op.sizingH;
      if (op.sizingV) node.layoutSizingVertical = op.sizingV;
      return;
    }
    case 'setPosition':
      node.x = op.x;
      node.y = op.y;
      return;
    case 'setTextSize': {
      if (node.type !== 'TEXT') throw new Error('не текстовый слой');
      await c.ensureFonts(node);
      const family = node.fontName === c.deps.mixed ? undefined : (node.fontName as FontName).family;
      const style = textStyleFor(c.ds, op.fontSize, family);
      if (style) {
        const imported = await c.deps.importStyle(style.key);
        await (node as unknown as TextNode).setTextStyleIdAsync(imported.id);
        return;
      }
      node.fontSize = op.fontSize;
      if (op.lineHeight) node.lineHeight = { unit: 'PIXELS', value: op.lineHeight };
      if (c.ds?.textStyles) {
        c.out.push({ targetId: c.plan.targetId, kind: 'no-token', nodeId: op.nodeId, message: `нет токена для font-size ${op.fontSize}` });
      }
      return;
    }
    case 'swapVariant':
      node.setProperties(op.props);
      return;
    case 'swapComponent': {
      // переносим текстовые свойства с совпадающими именами
      const texts: Record<string, string> = {};
      for (const [k, p] of Object.entries((node.componentProperties ?? {}) as Record<string, { type: string; value: string }>)) {
        if (p.type === 'TEXT') texts[k.split('#')[0]!] = p.value;
      }
      const comp = await c.deps.importComponent(op.componentKey);
      node.swapComponent(comp);
      const next: Record<string, string> = {};
      for (const k of Object.keys((node.componentProperties ?? {}) as object)) {
        const name = k.split('#')[0]!;
        if (texts[name] !== undefined) next[k] = texts[name]!;
      }
      if (Object.keys(next).length > 0) node.setProperties(next);
      return;
    }
    case 'crop': {
      const fills = node.fills === c.deps.mixed ? [] : ([...(node.fills as Paint[])] as Paint[]);
      const i = fills.findIndex((p) => p.type === 'IMAGE');
      if (i < 0) return;
      const paint = fills[i] as ImagePaint;
      const size = paint.imageHash ? await c.deps.imageSize(paint.imageHash) : null;
      if (!size) return;
      fills[i] = { ...paint, scaleMode: 'CROP', imageTransform: cropTransform(node.width, node.height, size.width, size.height, op.focal) };
      node.fills = fills;
      return;
    }
    case 'bindVariable': {
      const v = await c.deps.importVariable(op.variableKey);
      node.setBoundVariable(op.field as VariableBindableNodeField, v);
      return;
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Реальные зависимости поверх figma.* */
export function figmaApplyDeps(): ApplyDeps {
  const collections = new Map<string, Promise<VariableCollection | null>>();
  return {
    mixed: figma.mixed,
    loadFont: (f) => figma.loadFontAsync(f),
    importComponent: async (key) => {
      try {
        return await figma.importComponentByKeyAsync(key);
      } catch {
        const set = await figma.importComponentSetByKeyAsync(key);
        return set.defaultVariant;
      }
    },
    importVariable: (key) => figma.variables.importVariableByKeyAsync(key),
    collectionForKey: (key) => {
      let p = collections.get(key);
      if (!p) {
        p = (async () => {
          const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key);
          if (vars.length === 0) return null;
          const v = await figma.variables.importVariableByKeyAsync(vars[0]!.key);
          return figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
        })();
        collections.set(key, p);
      }
      return p;
    },
    importStyle: (key) => figma.importStyleByKeyAsync(key),
    imageSize: async (hash) => {
      const img = figma.getImageByHash(hash);
      return img ? img.getSizeAsync() : null;
    },
  };
}

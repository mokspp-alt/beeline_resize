import type {
  AutoLayout,
  ComponentRef,
  DesignIR,
  DesignNode,
  Fill,
  FontName as IrFontName,
  NodeType,
  StyleRef,
  TextInfo,
  VariableRef,
} from '@beeline-resize/shared';

/**
 * Сериализация исходного фрейма в DesignIR (spec figma-source-capture → Source description capture).
 * Все асинхронные обращения к Figma идут через `CaptureDeps`, чтобы тестироваться на моках.
 */

export interface CaptureDeps {
  mixed: symbol;
  getVariable(id: string): Promise<{ id: string; key: string; name: string; variableCollectionId: string; remote: boolean } | null>;
  getCollection(id: string): Promise<{ id: string; key: string; name: string; remote: boolean } | null>;
  getStyle(id: string): Promise<{ id: string; key: string; name: string; remote: boolean } | null>;
  getMainComponent(instance: InstanceNode): Promise<ComponentNode | null>;
  /** Имя библиотеки по ключу коллекции переменных (из figma.teamLibrary). */
  libraryNameForCollectionKey(key: string): string | undefined;
  /** Имя библиотеки по ключу компонента или набора компонентов (из конфигурации/скана). */
  libraryNameForComponentKey(key: string): string | undefined;
}

export function figmaCaptureDeps(libraryByCollectionKey: Map<string, string>, libraryByComponentKey: Map<string, string>): CaptureDeps {
  return {
    mixed: figma.mixed,
    getVariable: (id) => figma.variables.getVariableByIdAsync(id),
    getCollection: (id) => figma.variables.getVariableCollectionByIdAsync(id),
    getStyle: (id) => figma.getStyleByIdAsync(id),
    getMainComponent: (i) => i.getMainComponentAsync(),
    libraryNameForCollectionKey: (k) => libraryByCollectionKey.get(k),
    libraryNameForComponentKey: (k) => libraryByComponentKey.get(k),
  };
}

const KNOWN_TYPES = new Set<NodeType>([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'TEXT',
  'RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'LINE',
  'VECTOR',
  'BOOLEAN_OPERATION',
]);

type AnyNode = SceneNode & Record<string, any>;

interface Ctx {
  deps: CaptureDeps;
  originX: number;
  originY: number;
  fonts: Map<string, IrFontName>;
  varCache: Map<string, Promise<VariableRef | undefined>>;
}

export async function captureDesign(root: SceneNode, deps: CaptureDeps, meta: { fileKey?: string; pageName?: string } = {}): Promise<DesignIR> {
  const box = boundsOf(root as AnyNode);
  const ctx: Ctx = { deps, originX: box.x, originY: box.y, fonts: new Map(), varCache: new Map() };
  const node = await serializeNode(root as AnyNode, ctx, true);
  return {
    version: 1,
    source: {
      nodeId: root.id,
      name: root.name,
      width: (root as AnyNode).width,
      height: (root as AnyNode).height,
      ...(meta.fileKey ? { fileKey: meta.fileKey } : {}),
      ...(meta.pageName ? { pageName: meta.pageName } : {}),
    },
    root: node,
    fonts: [...ctx.fonts.values()],
  };
}

function boundsOf(n: AnyNode): { x: number; y: number; width: number; height: number } {
  const b = n.absoluteBoundingBox as Rect | null | undefined;
  if (b) return { x: b.x, y: b.y, width: b.width, height: b.height };
  return { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? 0, height: n.height ?? 0 };
}

async function serializeNode(n: AnyNode, ctx: Ctx, isRoot = false): Promise<DesignNode> {
  const b = boundsOf(n);
  const type: NodeType = KNOWN_TYPES.has(n.type as NodeType) ? (n.type as NodeType) : 'OTHER';
  const out: DesignNode = {
    id: n.id,
    name: n.name,
    type,
    visible: n.visible !== false,
    bbox: {
      x: round(b.x - ctx.originX),
      y: round(b.y - ctx.originY),
      width: round(b.width),
      height: round(b.height),
    },
  };

  if (typeof n.rotation === 'number' && n.rotation !== 0) out.rotation = n.rotation;
  if (typeof n.opacity === 'number' && n.opacity !== 1) out.opacity = n.opacity;
  if (!isRoot && n.constraints) out.constraints = { horizontal: n.constraints.horizontal, vertical: n.constraints.vertical };
  if (typeof n.clipsContent === 'boolean') out.clipsContent = n.clipsContent;
  if (typeof n.cornerRadius === 'number') out.cornerRadius = n.cornerRadius;
  if (n.isMask) out.isMask = true;

  const autoLayout = readAutoLayout(n);
  if (autoLayout) out.autoLayout = autoLayout;
  const childLayout = readChildLayout(n);
  if (!isRoot && childLayout) out.childLayout = childLayout;

  const fills = await readFills(n, ctx);
  if (fills) out.fills = fills;

  const bound = await readBoundVariables(n, ctx);
  if (bound && Object.keys(bound).length > 0) out.boundVariables = bound;

  const styles = await readStyles(n, ctx);
  if (styles && Object.keys(styles).length > 0) out.styles = styles;

  if (n.type === 'TEXT') out.text = await readText(n as unknown as TextNode & AnyNode, ctx);
  if (n.type === 'INSTANCE') {
    const component = await readComponent(n as unknown as InstanceNode & AnyNode, ctx);
    if (component) out.component = component;
  }

  if (Array.isArray(n.children) && n.children.length > 0) {
    out.children = [];
    for (const child of n.children as AnyNode[]) out.children.push(await serializeNode(child, ctx));
  }
  return out;
}

function readAutoLayout(n: AnyNode): AutoLayout | undefined {
  if (!n.layoutMode || n.layoutMode === 'NONE') return undefined;
  return {
    mode: n.layoutMode,
    wrap: n.layoutWrap === 'WRAP',
    itemSpacing: n.itemSpacing ?? 0,
    ...(typeof n.counterAxisSpacing === 'number' ? { counterAxisSpacing: n.counterAxisSpacing } : {}),
    padding: {
      top: n.paddingTop ?? 0,
      right: n.paddingRight ?? 0,
      bottom: n.paddingBottom ?? 0,
      left: n.paddingLeft ?? 0,
    },
    primaryAxisAlign: n.primaryAxisAlignItems ?? 'MIN',
    counterAxisAlign: n.counterAxisAlignItems ?? 'MIN',
    primarySizing: n.primaryAxisSizingMode ?? 'FIXED',
    counterSizing: n.counterAxisSizingMode ?? 'FIXED',
  };
}

function readChildLayout(n: AnyNode): DesignNode['childLayout'] {
  const parent = n.parent as AnyNode | null;
  if (!parent || !parent.layoutMode || parent.layoutMode === 'NONE') return undefined;
  return {
    positioning: n.layoutPositioning ?? 'AUTO',
    sizingH: n.layoutSizingHorizontal ?? 'FIXED',
    sizingV: n.layoutSizingVertical ?? 'FIXED',
    grow: n.layoutGrow ?? 0,
  };
}

async function variableRef(id: string, ctx: Ctx): Promise<VariableRef | undefined> {
  let p = ctx.varCache.get(id);
  if (!p) {
    p = (async () => {
      const v = await ctx.deps.getVariable(id);
      if (!v) return { id };
      const c = await ctx.deps.getCollection(v.variableCollectionId);
      const libraryName = c ? ctx.deps.libraryNameForCollectionKey(c.key) : undefined;
      return {
        id: v.id,
        key: v.key,
        name: v.name,
        ...(c ? { collectionName: c.name } : {}),
        ...(libraryName ? { libraryName } : {}),
      };
    })();
    ctx.varCache.set(id, p);
  }
  return p;
}

function aliasId(a: unknown): string | undefined {
  if (a && typeof a === 'object' && (a as { type?: string }).type === 'VARIABLE_ALIAS') return (a as { id: string }).id;
  return undefined;
}

/** Привязки скалярных полей (отступы, радиусы, размеры). Привязки заливок читаются в readFills. */
async function readBoundVariables(n: AnyNode, ctx: Ctx): Promise<Record<string, VariableRef> | undefined> {
  const bv = n.boundVariables as Record<string, unknown> | undefined;
  if (!bv) return undefined;
  const out: Record<string, VariableRef> = {};
  for (const [field, alias] of Object.entries(bv)) {
    if (field === 'fills' || field === 'strokes' || field === 'effects' || field === 'textRangeFills') continue;
    const id = aliasId(Array.isArray(alias) ? alias[0] : alias);
    if (!id) continue;
    const ref = await variableRef(id, ctx);
    if (ref) out[field] = ref;
  }
  return out;
}

const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');

async function readFills(n: AnyNode, ctx: Ctx): Promise<Fill[] | undefined> {
  if (!('fills' in n) || n.fills === ctx.deps.mixed || !Array.isArray(n.fills)) return undefined;
  const out: Fill[] = [];
  for (const p of n.fills as Paint[]) {
    const base = { visible: p.visible !== false, opacity: p.opacity ?? 1 };
    if (p.type === 'SOLID') {
      const id = aliasId(p.boundVariables?.color);
      const variable = id ? await variableRef(id, ctx) : undefined;
      out.push({
        type: 'SOLID',
        ...base,
        color: `#${hex(p.color.r)}${hex(p.color.g)}${hex(p.color.b)}`.toUpperCase(),
        ...(variable ? { variable } : {}),
      });
    } else if (p.type === 'IMAGE') {
      out.push({ type: 'IMAGE', ...base, ...(p.imageHash ? { imageHash: p.imageHash } : {}), scaleMode: p.scaleMode });
    } else if (p.type.startsWith('GRADIENT')) {
      out.push({ type: 'GRADIENT', ...base });
    } else if (p.type === 'VIDEO') {
      out.push({ type: 'VIDEO', ...base });
    } else {
      out.push({ type: 'OTHER', ...base });
    }
  }
  return out;
}

async function styleRef(id: unknown, ctx: Ctx): Promise<StyleRef | undefined> {
  if (typeof id !== 'string' || id === '') return undefined;
  const s = await ctx.deps.getStyle(id);
  return s ? { id: s.id, key: s.key, name: s.name, isRemote: s.remote } : undefined;
}

async function readStyles(n: AnyNode, ctx: Ctx): Promise<Record<string, StyleRef> | undefined> {
  const out: Record<string, StyleRef> = {};
  const pairs: Array<[string, unknown]> = [
    ['fill', n.fillStyleId],
    ['stroke', n.strokeStyleId],
    ['effect', n.effectStyleId],
    ['grid', n.gridStyleId],
  ];
  for (const [k, id] of pairs) {
    if (id === ctx.deps.mixed) continue;
    const ref = await styleRef(id, ctx);
    if (ref) out[k] = ref;
  }
  return out;
}

async function readText(n: TextNode & AnyNode, ctx: Ctx): Promise<TextInfo> {
  const m = ctx.deps.mixed;
  const mixed = n.fontSize === m || n.fontName === m || n.lineHeight === m || n.textStyleId === m;
  const fontSize = (n.fontSize === m ? n.getRangeFontSize(0, 1) : n.fontSize) as number;
  const font = (n.fontName === m ? n.getRangeFontName(0, 1) : n.fontName) as FontName;
  const lh = (n.lineHeight === m ? n.getRangeLineHeight(0, 1) : n.lineHeight) as LineHeight;

  if (n.fontName === m) {
    for (const f of n.getRangeAllFontNames(0, n.characters.length) as FontName[]) addFont(ctx, f);
  } else {
    addFont(ctx, font);
  }

  const textStyle = n.textStyleId === m ? undefined : await styleRef(n.textStyleId, ctx);
  return {
    characters: n.characters,
    fontSize,
    font: { family: font.family, style: font.style },
    lineHeight: lh.unit === 'AUTO' ? 'AUTO' : lh.unit === 'PIXELS' ? lh.value : round((lh.value / 100) * fontSize),
    align: n.textAlignHorizontal,
    autoResize: n.textAutoResize,
    ...(textStyle ? { textStyle } : {}),
    mixed,
  };
}

function addFont(ctx: Ctx, f: FontName) {
  ctx.fonts.set(`${f.family}::${f.style}`, { family: f.family, style: f.style });
}

async function readComponent(n: InstanceNode & AnyNode, ctx: Ctx): Promise<ComponentRef | undefined> {
  const main = await ctx.deps.getMainComponent(n);
  if (!main) return undefined;
  const set = main.parent && main.parent.type === 'COMPONENT_SET' ? (main.parent as ComponentSetNode) : undefined;

  const variantProps: Record<string, string> = {};
  const componentProps: Record<string, string | boolean> = {};
  const props = (n.componentProperties ?? {}) as Record<string, { type: string; value: string | boolean }>;
  for (const [rawName, p] of Object.entries(props)) {
    const name = rawName.split('#')[0]!;
    if (p.type === 'VARIANT') variantProps[name] = String(p.value);
    else componentProps[name] = p.value;
  }

  const libraryName = ctx.deps.libraryNameForComponentKey(set?.key ?? main.key) ?? ctx.deps.libraryNameForComponentKey(main.key);
  const overrides = (n.overrides ?? []) as Array<{ id: string }>;
  return {
    key: main.key,
    name: main.name,
    ...(set ? { componentSetKey: set.key, componentSetName: set.name } : {}),
    ...(libraryName ? { libraryName } : {}),
    isRemote: main.remote,
    variantProps,
    componentProps,
    overriddenNodeIds: overrides.map((o) => o.id),
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

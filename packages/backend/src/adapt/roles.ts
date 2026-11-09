import type { DesignIR, DesignNode, ElementRole, RoleEntry, RoleMap } from '@beeline-resize/shared';

/**
 * Детерминированное определение ролей (фолбэк для LLM, spec layout-adaptation → Element role detection).
 * Роли назначаются «значимым» узлам: детям корня, детям единственной обёртки и текстам/инстансам до глубины 3.
 */

export const DEFAULT_PRIORITY: Record<ElementRole, number> = {
  'status-bar': 99,
  cta: 95,
  logo: 90,
  navigation: 88,
  'tab-bar': 88,
  heading: 85,
  price: 80,
  'hero-image': 70,
  subheading: 60,
  form: 60,
  card: 55,
  list: 55,
  background: 50,
  body: 45,
  container: 40,
  icon: 30,
  other: 30,
  legal: 20,
  decor: 10,
};

const RX = {
  logo: /(logo|лого|beeline|билайн)/i,
  cta: /(button|btn|кнопк|cta)/i,
  price: /(price|цена|стоимост)/i,
  priceText: /(\d[\d\s]*(?:[.,]\d+)?\s?(?:₽|руб|р\.|\/\s?мес))/i,
  legal: /(legal|disclaimer|сноск|юр|условия|оферт|ооо|пао|ао «|реклама|подробнее на)/i,
  status: /(status\s?bar|статус\s?бар)/i,
  tab: /(tab\s?bar|tabbar|таб\s?бар|bottom\s?nav|нижн.*навиг)/i,
  nav: /(nav|navigation|header|хедер|шапк|toolbar|app\s?bar|навбар|меню)/i,
  form: /(form|input|field|поле|форма)/i,
  bg: /(background|bg|фон)/i,
  card: /(card|карточк|tile|плитк)/i,
  icon: /(icon|иконк|ic[_/ ])/i,
};

const area = (n: DesignNode) => n.bbox.width * n.bbox.height;
const hasImage = (n: DesignNode) => n.fills?.some((f) => f.type === 'IMAGE' && f.visible) ?? false;
const label = (n: DesignNode) => `${n.name} ${n.component?.componentSetName ?? ''} ${n.component?.name ?? ''}`;

function textsOf(n: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  const visit = (x: DesignNode) => {
    if (x.text) out.push(x);
    x.children?.forEach(visit);
  };
  visit(n);
  return out;
}

/** Корневые элементы: дети корня, а если корень — одна обёртка, то её дети. */
export function significantElements(ir: DesignIR): { wrapper?: DesignNode; elements: DesignNode[] } {
  const visible = (ir.root.children ?? []).filter((c) => c.visible);
  const nonBg = visible.filter((c) => !isFullBleed(c, ir));
  if (nonBg.length === 1 && (nonBg[0]!.children?.length ?? 0) >= 2 && nonBg[0]!.type !== 'INSTANCE' && !nonBg[0]!.text) {
    const wrapper = nonBg[0]!;
    return { wrapper, elements: [...visible.filter((c) => c !== wrapper), ...(wrapper.children ?? []).filter((c) => c.visible)] };
  }
  return { elements: visible };
}

export function isFullBleed(n: DesignNode, ir: DesignIR): boolean {
  return area(n) >= 0.9 * ir.source.width * ir.source.height && (hasImage(n) || n.type === 'RECTANGLE' || RX.bg.test(n.name));
}

function isRepeated(n: DesignNode, siblings: DesignNode[]): boolean {
  const others = siblings.filter((s) => s !== n && s.type === n.type);
  // Один и тот же компонент — повтор; иначе похожие по размеру контейнеры с содержимым
  if (n.component && others.some((s) => s.component?.key === n.component!.key)) return true;
  const similar = others.filter(
    (s) => Math.abs(s.bbox.width - n.bbox.width) <= 0.1 * n.bbox.width && Math.abs(s.bbox.height - n.bbox.height) <= 0.2 * n.bbox.height,
  );
  return similar.length >= 1 && (n.children?.length ?? 0) > 0;
}

export function heuristicRoles(ir: DesignIR): RoleMap {
  const roles: Record<string, RoleEntry> = {};
  const set = (n: DesignNode, role: ElementRole, extra: Partial<RoleEntry> = {}) => {
    if (!roles[n.id]) roles[n.id] = { role, priority: DEFAULT_PRIORITY[role], ...extra };
  };
  const W = ir.source.width;
  const H = ir.source.height;
  const { elements } = significantElements(ir);

  // Тексты: заголовок — самый крупный, legal — самый мелкий/юридический
  const allTexts = elements.flatMap(textsOf).filter((t) => t.visible);
  const sizes = allTexts.map((t) => t.text!.fontSize).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 16;
  const maxSize = sizes[sizes.length - 1] ?? 16;
  const minSize = sizes[0] ?? 16;

  for (const n of elements) {
    const l = label(n);
    const isTop = n.bbox.y <= H * 0.08;
    const isBottom = n.bbox.y + n.bbox.height >= H * 0.92;
    const fullWidth = n.bbox.width >= W * 0.9;

    if (isFullBleed(n, ir)) set(n, 'background', { focal: { x: 0.5, y: 0.5 } });
    else if (RX.status.test(l) || (fullWidth && isTop && n.bbox.y <= 1 && n.bbox.height <= 60 && !n.text && H > W)) set(n, 'status-bar');
    else if (RX.tab.test(l) || (fullWidth && isBottom && n.bbox.height >= 48 && n.bbox.height <= 110 && H > W && !n.text)) set(n, 'tab-bar');
    else if (RX.nav.test(l) && (isTop || n.bbox.y <= H * 0.15)) set(n, 'navigation');
    else if (RX.logo.test(l)) set(n, 'logo');
    else if (RX.cta.test(l)) set(n, 'cta');
    else if (n.text) {
      // назначаются ниже вместе с вложенными текстами
    } else if (hasImage(n) && area(n) >= 0.12 * W * H) set(n, 'hero-image', { focal: { x: 0.5, y: 0.5 } });
    else if (RX.form.test(l)) set(n, 'form');
    else if (RX.price.test(l)) set(n, 'price');
    else if (RX.legal.test(l)) set(n, 'legal');
    else if (n.type === 'INSTANCE' && n.bbox.width <= 48 && n.bbox.height <= 48) set(n, 'icon');
    else if ((n.children ?? []).filter((c) => isRepeated(c, n.children ?? [])).length >= 2) set(n, 'list');
    else if (RX.card.test(l) || isRepeated(n, elements)) set(n, 'card');
    else if (['VECTOR', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'BOOLEAN_OPERATION'].includes(n.type)) set(n, 'decor');
    else if (hasImage(n)) set(n, 'hero-image', { focal: { x: 0.5, y: 0.5 } });
    else if (n.children?.length) set(n, 'container');
    else set(n, 'decor');
  }

  for (const t of allTexts) {
    if (roles[t.id]) continue;
    const chars = t.text!.characters;
    const fs = t.text!.fontSize;
    if (RX.priceText.test(chars) || RX.price.test(t.name)) set(t, 'price');
    else if (RX.legal.test(chars) || RX.legal.test(t.name) || (fs === minSize && fs < median && chars.length > 40)) set(t, 'legal');
    else if (fs === maxSize && (fs >= median * 1.3 || fs >= 28)) set(t, 'heading');
    else if (fs > median * 1.1) set(t, 'subheading');
    else set(t, 'body');
  }

  // Инстансы-кнопки внутри контейнеров
  for (const e of elements) {
    const visit = (x: DesignNode, depth: number) => {
      if (depth > 3) return;
      if (x !== e && x.type === 'INSTANCE' && RX.cta.test(label(x))) set(x, 'cta');
      x.children?.forEach((c) => visit(c, depth + 1));
    };
    visit(e, 0);
  }

  return { roles };
}

/** Компактное описание узлов для промпта: только то, что нужно для решений. */
export interface OutlineNode {
  id: string;
  type: string;
  name: string;
  box: [number, number, number, number];
  text?: string;
  fontSize?: number;
  component?: string;
  image?: true;
  layout?: string;
  children?: OutlineNode[];
}

export function outline(ir: DesignIR, maxDepth = 3, maxText = 120): OutlineNode {
  const conv = (n: DesignNode, depth: number): OutlineNode => {
    const o: OutlineNode = {
      id: n.id,
      type: n.type,
      name: n.name,
      box: [Math.round(n.bbox.x), Math.round(n.bbox.y), Math.round(n.bbox.width), Math.round(n.bbox.height)],
    };
    if (n.text) {
      o.text = n.text.characters.slice(0, maxText);
      o.fontSize = n.text.fontSize;
    }
    if (n.component) o.component = `${n.component.componentSetName ?? n.component.name}${Object.keys(n.component.variantProps).length ? ` (${Object.entries(n.component.variantProps).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`;
    if (hasImage(n)) o.image = true;
    if (n.autoLayout) o.layout = `${n.autoLayout.mode}${n.autoLayout.wrap ? ' wrap' : ''} gap ${n.autoLayout.itemSpacing}`;
    const kids = (n.children ?? []).filter((c) => c.visible);
    if (kids.length && depth < maxDepth && n.type !== 'INSTANCE') o.children = kids.map((c) => conv(c, depth + 1));
    return o;
  };
  return conv(ir.root, 0);
}

import {
  ALWAYS_VISIBLE_BANNER_ROLES,
  MIN_TOUCH_TARGET,
  appPlatform,
  nearestInScale,
  resolveDsOperations,
  type AdaptationMode,
  type DesignIR,
  type DesignNode,
  type DesignSystemConfig,
  type ElementRole,
  type LayoutPlan,
  type Operation,
  type PlanTemplate,
  type Rect,
  type ReportItem,
  type RoleMap,
  type SizePreset,
} from '@beeline-resize/shared';
import { isFullBleed, significantElements } from './roles.js';

/**
 * Детерминированный солвер (design D3): переводит семантический шаблон класса
 * в операции для конкретного размера. Пиксели считает только он.
 */

export interface SolveInput {
  ir: DesignIR;
  roles: RoleMap;
  template: PlanTemplate;
  preset: SizePreset;
  mode: AdaptationMode;
  ds?: DesignSystemConfig;
  ai: boolean;
  fallbackReason?: string;
}

export interface SolveResult {
  plan: LayoutPlan;
  report: ReportItem[];
  /** Итоговые прямоугольники позиционированных элементов (в координатах кадра). */
  boxes: Map<string, Rect>;
  /** id скрытых элементов. */
  hidden: Set<string>;
}

const CHAR_W = 0.56; // средняя ширина символа в долях кегля (кириллица, гротеск)
const LINE = 1.2;

export function lineHeightOf(n: DesignNode, fs: number): number {
  const lh = n.text?.lineHeight;
  if (typeof lh === 'number' && n.text) return (lh / n.text.fontSize) * fs;
  return fs * LINE;
}

/** Оценка высоты текста при ширине w и кегле fs. */
export function textHeight(n: DesignNode, fs: number, w: number): number {
  const chars = [...(n.text?.characters ?? '')].length || 1;
  const perLine = Math.max(1, Math.floor(w / (fs * CHAR_W)));
  const lines = Math.ceil(chars / perLine);
  return Math.ceil(lines * lineHeightOf(n, fs));
}

/** Минимальная ширина текста, чтобы уложиться в `maxLines` строк. */
export function textWidthFor(n: DesignNode, fs: number, maxLines: number): number {
  const chars = [...(n.text?.characters ?? '')].length || 1;
  return Math.ceil((chars / Math.max(1, maxLines)) * fs * CHAR_W) + 2;
}

function textsIn(n: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  const visit = (x: DesignNode) => {
    if (x.text && x.visible) out.push(x);
    x.children?.forEach(visit);
  };
  visit(n);
  return out;
}

const r = (v: number) => Math.round(v);

class Ctx {
  ops: Operation[] = [];
  report: ReportItem[] = [];
  boxes = new Map<string, Rect>();
  hidden = new Set<string>();

  constructor(
    readonly input: SolveInput,
    readonly W: number,
    readonly H: number,
  ) {}

  get targetId() {
    return this.input.preset.id;
  }

  role(n: DesignNode): ElementRole {
    return this.input.roles.roles[n.id]?.role ?? 'other';
  }

  priority(n: DesignNode): number {
    return this.input.roles.roles[n.id]?.priority ?? 30;
  }

  hide(n: DesignNode, reason: string) {
    if (this.hidden.has(n.id)) return;
    this.hidden.add(n.id);
    this.boxes.delete(n.id);
    this.ops.push({ op: 'hide', nodeId: n.id, reason });
    this.report.push({ targetId: this.targetId, kind: 'hidden', nodeId: n.id, message: `${this.role(n)} скрыт: ${reason}` });
  }

  place(n: DesignNode, x: number, y: number, w: number, h: number, opts: { resizeText?: boolean } = {}) {
    const box = { x: r(x), y: r(y), width: Math.max(1, r(w)), height: Math.max(1, r(h)) };
    this.boxes.set(n.id, box);
    this.ops.push({ op: 'setPosition', nodeId: n.id, x: box.x, y: box.y });
    if (n.text && !opts.resizeText) {
      this.ops.push({ op: 'setSize', nodeId: n.id, width: box.width });
    } else {
      this.ops.push({ op: 'setSize', nodeId: n.id, width: box.width, height: box.height });
    }
  }

  fontSize(n: DesignNode, fs: number) {
    const v = Math.round(fs);
    if (n.text && v !== n.text.fontSize) this.ops.push({ op: 'setTextSize', nodeId: n.id, fontSize: v });
  }

  crop(n: DesignNode) {
    const focal = this.input.template.focal[n.id] ?? this.input.roles.roles[n.id]?.focal ?? { x: 0.5, y: 0.5 };
    if (n.fills?.some((f) => f.type === 'IMAGE')) this.ops.push({ op: 'crop', nodeId: n.id, focal });
  }
}

export function solve(input: SolveInput): SolveResult {
  const { preset, ir, ds } = input;
  const W = preset.width;
  const H = preset.height === 'auto' ? ir.source.height : preset.height;
  const ctx = new Ctx(input, W, H);

  const dsOps = resolveDsOperations(ir.root, ds, { preset, mode: input.mode });
  ctx.report.push(...dsOps.report);

  // Скрытия из шаблона (logo/cta не скрываются — шаблон уже проверен)
  const byId = new Map<string, DesignNode>();
  const index = (n: DesignNode) => {
    byId.set(n.id, n);
    n.children?.forEach(index);
  };
  index(ir.root);
  for (const h of input.template.hide) {
    const n = byId.get(h.nodeId);
    if (n && !ALWAYS_VISIBLE_BANNER_ROLES.includes(ctx.role(n))) ctx.hide(n, h.reason);
  }

  if (input.mode === 'banner') solveBanner(ctx);
  else if (input.mode === 'app') solveApp(ctx);
  else solveWeb(ctx);

  ctx.ops.push(...dsOps.operations);
  if (!input.ai && input.fallbackReason) {
    ctx.report.unshift({ targetId: preset.id, kind: 'fallback', message: input.fallbackReason });
  }

  const plan: LayoutPlan = {
    targetId: preset.id,
    width: W,
    height: preset.height,
    mode: input.mode,
    sizeClass: input.template.sizeClass,
    composition: input.template.composition,
    variableModes: dsOps.variableModes,
    operations: ctx.ops,
    ai: input.ai,
    ...(input.fallbackReason && !input.ai ? { fallbackReason: input.fallbackReason } : {}),
  };
  return { plan, report: ctx.report, boxes: ctx.boxes, hidden: ctx.hidden };
}

/* ───────────────────────────── Баннеры ───────────────────────────── */

/** Порядок скрытия при нехватке места: сначала наименее важное. */
const HIDE_ORDER: ElementRole[] = ['decor', 'legal', 'icon', 'body', 'subheading', 'other', 'container', 'card', 'list', 'form', 'price', 'hero-image'];

interface Item {
  n: DesignNode;
  role: ElementRole;
  w: number;
  h: number;
  fs?: number;
}

function solveBanner(ctx: Ctx) {
  const { ir, template } = ctx.input;
  const { W, H } = ctx;
  const minFont = ctx.input.ds?.minFontSize.banner ?? 10;
  const { wrapper, elements } = significantElements(ir);
  if (ir.root.autoLayout) ctx.ops.push({ op: 'setLayout', nodeId: ir.root.id, mode: 'NONE' });
  if (wrapper) {
    if (wrapper.autoLayout) ctx.ops.push({ op: 'setLayout', nodeId: wrapper.id, mode: 'NONE' });
    ctx.ops.push({ op: 'setPosition', nodeId: wrapper.id, x: 0, y: 0 }, { op: 'setSize', nodeId: wrapper.id, width: W, height: H });
  }

  const k = Math.sqrt((W * H) / (ir.source.width * ir.source.height));
  const p = Math.max(4, Math.min(64, r(Math.min(W, H) * 0.07)));
  const gap = Math.max(4, r(p * 0.6));

  // Фон — на весь кадр
  const live = elements.filter((e) => !ctx.hidden.has(e.id));
  for (const e of live.filter((e) => isFullBleed(e, ir) || ctx.role(e) === 'background')) {
    ctx.place(e, 0, 0, W, H);
    ctx.crop(e);
  }
  let content = live.filter((e) => !(isFullBleed(e, ir) || ctx.role(e) === 'background'));

  // Порядок: шаблон, затем приоритет; logo первым, cta последним
  const orderIdx = new Map(template.order.map((id, i) => [id, i]));
  content.sort((a, b) => {
    const ra = ctx.role(a);
    const rb = ctx.role(b);
    if (ra === 'logo' && rb !== 'logo') return -1;
    if (rb === 'logo' && ra !== 'logo') return 1;
    if (ra === 'cta' && rb !== 'cta') return 1;
    if (rb === 'cta' && ra !== 'cta') return -1;
    if (ra === 'legal' && rb !== 'legal') return 1;
    if (rb === 'legal' && ra !== 'legal') return -1;
    const oa = orderIdx.get(a.id) ?? 1e3;
    const ob = orderIdx.get(b.id) ?? 1e3;
    if (oa !== ob) return oa - ob;
    return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
  });

  // Декор в маленьких баннерах убираем сразу
  for (const d of content.filter((e) => ctx.role(e) === 'decor')) {
    if (W * H < 0.25 * ir.source.width * ir.source.height) ctx.hide(d, 'декор не помещается в формат');
  }
  content = content.filter((e) => !ctx.hidden.has(e.id));

  // Медиа-зона для split-композиций
  let area = { x: p, y: p, w: W - 2 * p, h: H - 2 * p };
  const media = content.find((e) => ctx.role(e) === 'hero-image');
  const comp = template.composition;
  if (media && (comp === 'split-h' || comp === 'split-v')) {
    if (comp === 'split-h') {
      const mw = r(W * 0.42);
      ctx.place(media, W - mw, 0, mw, H);
      area = { x: p, y: p, w: W - mw - 2 * p, h: H - 2 * p };
    } else {
      const mh = r(H * 0.42);
      ctx.place(media, 0, 0, W, mh);
      area = { x: p, y: mh + gap, w: W - 2 * p, h: H - mh - gap - p };
    }
    ctx.crop(media);
    content = content.filter((e) => e !== media);
  } else if (media && comp === 'overlay') {
    ctx.place(media, 0, 0, W, H);
    ctx.crop(media);
    content = content.filter((e) => e !== media);
  } else if (media && comp === 'row') {
    ctx.hide(media, 'изображение не помещается в узкий формат');
    content = content.filter((e) => e !== media);
  }

  const inRow = comp === 'row' || (area.h < 150 && area.w / area.h >= 3);
  if (inRow) layoutRow(ctx, content, area, k, gap, minFont);
  else layoutStack(ctx, content, area, k, gap, minFont);
}

function scaleText(fs: number, k: number, minFont: number) {
  return Math.max(minFont, Math.round(fs * k));
}

function buildItem(ctx: Ctx, n: DesignNode, k: number, minFont: number, maxW: number, maxH: number, row = false): Item {
  const role = ctx.role(n);
  if (n.text) {
    return { n, role, w: maxW, h: 0, fs: scaleText(n.text.fontSize, k * 1.15, minFont) };
  }
  const aspect = n.bbox.width / Math.max(1, n.bbox.height);
  let h = n.bbox.height * k;
  if (role === 'cta') h = row ? Math.min(maxH * 0.7, Math.max(h * 1.6, 24)) : Math.max(h, Math.min(maxH, 24));
  if (role === 'logo') h = row ? Math.min(maxH * 0.6, Math.max(h * 1.6, 20)) : Math.max(h, Math.min(maxH * 0.5, 20));
  h = Math.min(h, maxH);
  let w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }
  return { n, role, w, h };
}

/** Тексты внутри непрозрачных элементов (кнопка) масштабируются вместе с ними. */
function scaleInnerTexts(ctx: Ctx, n: DesignNode, factor: number, minFont: number) {
  if (n.text) return;
  for (const t of textsIn(n)) ctx.fontSize(t, Math.max(minFont, t.text!.fontSize * factor));
}

function hideNext(ctx: Ctx, items: Item[], why: (it: Item) => string): boolean {
  for (const role of HIDE_ORDER) {
    const candidates = items.filter((i) => i.role === role).sort((a, b) => ctx.priority(a.n) - ctx.priority(b.n));
    const victim = candidates[0];
    if (victim) {
      ctx.hide(victim.n, why(victim));
      items.splice(items.indexOf(victim), 1);
      return true;
    }
  }
  return false;
}

function layoutStack(ctx: Ctx, nodes: DesignNode[], area: { x: number; y: number; w: number; h: number }, k: number, gap: number, minFont: number) {
  const items = nodes.map((n) => buildItem(ctx, n, k, minFont, area.w, area.h));
  let shrink = 1;
  const measure = () => {
    for (const it of items) {
      if (it.n.text) {
        it.fs = scaleText(it.n.text.fontSize, k * 1.15 * shrink, minFont);
        it.w = area.w;
        it.h = textHeight(it.n, it.fs, it.w);
      }
    }
    return items.reduce((s, it) => s + it.h, 0) + gap * Math.max(0, items.length - 1);
  };
  let total = measure();
  while (total > area.h && shrink > 0.5) {
    shrink -= 0.1;
    total = measure();
  }
  while (total > area.h && hideNext(ctx, items, (it) => (it.n.text ? `не помещается при минимальном размере ${minFont}` : 'не помещается в формат'))) {
    total = measure();
  }
  if (total > area.h) {
    ctx.report.push({ targetId: ctx.targetId, kind: 'overflow', message: `контент не помещается по высоте на ${r(total - area.h)} px` });
  }
  // Вертикальное центрирование внутри зоны
  let y = area.y + Math.max(0, (area.h - total) / 2);
  for (const it of items) {
    const x = it.n.text ? area.x : it.role === 'cta' || it.role === 'logo' ? area.x : area.x + (area.w - it.w) / 2;
    ctx.place(it.n, x, y, it.w, it.h);
    if (it.fs) ctx.fontSize(it.n, it.fs);
    else scaleInnerTexts(ctx, it.n, it.h / Math.max(1, it.n.bbox.height), minFont);
    y += it.h + gap;
  }
}

function layoutRow(ctx: Ctx, nodes: DesignNode[], area: { x: number; y: number; w: number; h: number }, k: number, gap: number, minFont: number) {
  const items = nodes.map((n) => buildItem(ctx, n, k, minFont, area.w * 0.3, area.h, true));
  // В полосе заголовок — до двух строк, остальные тексты — в одну
  const maxLines = (it: Item) =>
    it.role === 'heading' ? Math.max(1, Math.min(2, Math.floor(area.h / lineHeightOf(it.n, it.fs!)))) : 1;
  const measure = () => {
    for (const it of items) {
      if (it.n.text) {
        it.fs = Math.min(it.fs!, Math.floor(area.h / LINE));
        it.w = textWidthFor(it.n, it.fs, maxLines(it));
        it.h = Math.min(area.h, textHeight(it.n, it.fs, it.w));
      }
    }
    return items.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, items.length - 1);
  };
  let total = measure();
  while (total > area.w && hideNext(ctx, items, (it) => (it.n.text ? `не помещается при минимальном размере ${minFont}` : 'не помещается в узкий формат'))) {
    total = measure();
  }
  // Остался только заголовок — уменьшаем кегль до минимума
  while (total > area.w && items.some((it) => it.fs && it.fs > minFont)) {
    for (const it of items) if (it.fs && it.fs > minFont) it.fs -= 1;
    total = measure();
  }
  if (total > area.w) {
    ctx.report.push({ targetId: ctx.targetId, kind: 'overflow', message: `контент не помещается по ширине на ${r(total - area.w)} px` });
  }
  // Свободное место отдаём текстам
  const free = Math.max(0, area.w - total);
  const texts = items.filter((it) => it.n.text);
  for (const t of texts) {
    t.w += free / texts.length;
    t.h = Math.min(area.h, textHeight(t.n, t.fs!, t.w));
  }
  let x = area.x;
  for (const it of items) {
    const y = area.y + (area.h - it.h) / 2;
    ctx.place(it.n, x, y, it.w, it.h);
    if (it.fs) ctx.fontSize(it.n, it.fs);
    else scaleInnerTexts(ctx, it.n, it.h / Math.max(1, it.n.bbox.height), minFont);
    x += it.w + gap;
  }
}

/* ───────────────────────────── Web ───────────────────────────── */

function sidePadding(W: number): number {
  if (W < 768) return 16;
  if (W < 1280) return 32;
  return 0; // desktop — оставляем отступы исходника
}

function isRepeatedRow(n: DesignNode): boolean {
  const kids = (n.children ?? []).filter((c) => c.visible && c.childLayout?.positioning !== 'ABSOLUTE');
  if (kids.length < 2) return false;
  const first = kids[0]!;
  return kids.every(
    (c) =>
      (c.component && first.component && c.component.key === first.component.key) ||
      (c.type === first.type && Math.abs(c.bbox.width - first.bbox.width) <= 0.1 * first.bbox.width),
  );
}

function solveWeb(ctx: Ctx) {
  const { ir, template, ds } = ctx.input;
  const { W } = ctx;
  const srcW = ir.source.width;
  const minFont = ds?.minFontSize.web ?? 12;
  const pad = sidePadding(W);
  const contentW = W - 2 * (pad || 0);
  const shrinking = W < srcW;

  // Корень — вертикальный стек секций, высота по содержимому
  const sections = (ir.root.children ?? []).filter((c) => c.visible);
  if (!ir.root.autoLayout || ir.root.autoLayout.mode !== 'VERTICAL') {
    ctx.ops.push({ op: 'setLayout', nodeId: ir.root.id, mode: 'VERTICAL', itemSpacing: 0 });
    const order = [...sections].sort((a, b) => a.bbox.y - b.bbox.y).map((s) => s.id);
    ctx.ops.push({ op: 'reorder', nodeId: ir.root.id, order });
  }
  ctx.ops.push({ op: 'setSize', nodeId: ir.root.id, width: W, sizingV: 'HUG' });
  for (const s of sections) {
    if (s.childLayout?.positioning === 'ABSOLUTE') continue;
    ctx.ops.push({ op: 'setSize', nodeId: s.id, sizingH: 'FILL' });
  }

  const overrides = new Map(template.operations.map((o) => [o.nodeId, o]));
  const visit = (n: DesignNode, depth: number) => {
    if (n.type === 'INSTANCE') return; // инстансы атомарны (design D4)
    const al = n.autoLayout;
    const override = overrides.get(n.id);

    let finalMode: 'HORIZONTAL' | 'VERTICAL' | undefined = al && al.mode !== 'GRID' ? al.mode : al ? 'VERTICAL' : undefined;
    let wrap: boolean | undefined;
    if (override) {
      ctx.ops.push(override);
      if (override.op === 'setLayout' && override.mode !== 'NONE') finalMode = override.mode;
    } else if (al && al.mode === 'HORIZONTAL' && depth > 0) {
      const kids = (n.children ?? []).filter((c) => c.visible && c.childLayout?.positioning !== 'ABSOLUTE');
      const repeated = isRepeatedRow(n);
      const cols = repeated ? Math.min(kids.length, template.columns ?? kids.length) : kids.length;
      // Ширина ряда в исходнике: если она больше контентной ширины мобильного — ряд складывается в столбик
      const needed = kids.reduce((s, c) => s + c.bbox.width, 0) + al.itemSpacing * (kids.length - 1);
      if (repeated && cols === 1) {
        finalMode = 'VERTICAL';
        ctx.ops.push({ op: 'setLayout', nodeId: n.id, mode: 'VERTICAL' });
        kids.forEach((c) => ctx.ops.push({ op: 'setSize', nodeId: c.id, sizingH: 'FILL' }));
      } else if (repeated && cols < kids.length) {
        const gap = al.itemSpacing;
        const cw = Math.floor((contentW - gap * (cols - 1)) / cols);
        wrap = true;
        ctx.ops.push({ op: 'setLayout', nodeId: n.id, mode: 'HORIZONTAL', wrap: true, itemSpacing: gap });
        kids.forEach((c) => ctx.ops.push({ op: 'setSize', nodeId: c.id, width: cw, sizingH: 'FIXED' }));
      } else if (!repeated && kids.length > 1 && shrinking && W < 768 && needed > contentW) {
        finalMode = 'VERTICAL';
        ctx.ops.push({ op: 'setLayout', nodeId: n.id, mode: 'VERTICAL' });
        kids.forEach((c) => ctx.ops.push({ op: 'setSize', nodeId: c.id, sizingH: 'FILL' }));
      }
    }

    // Боковые отступы секций (с итоговым направлением, чтобы не затереть перестройку)
    if (al && finalMode && depth === 1 && pad > 0 && (al.padding.left > pad || al.padding.right > pad)) {
      ctx.ops.push({ op: 'setLayout', nodeId: n.id, mode: finalMode, ...(wrap ? { wrap } : {}), padding: { ...al.padding, left: pad, right: pad } });
      for (const field of ['paddingLeft', 'paddingRight']) {
        const t = tokenOrReport(ctx, field, pad, n.id);
        if (t) ctx.ops.push(t);
      }
    }

    // Изображения — на всю ширину контента с сохранением пропорций
    if (n.fills?.some((f) => f.type === 'IMAGE' && f.visible) && shrinking && n.bbox.width > contentW) {
      const h = r((n.bbox.height * contentW) / n.bbox.width);
      ctx.ops.push({ op: 'setSize', nodeId: n.id, width: contentW, height: h });
      ctx.crop(n);
    }

    // Типографика: если ДС переключает моды — кегль меняет ДС; иначе масштабируем крупные тексты
    if (n.text && !n.text.textStyle && n.text.fontSize > 24) {
      const ratio = W / srcW;
      const f = ratio < 1 ? Math.pow(Math.max(ratio, 0.5), 0.6) : Math.min(Math.pow(ratio, 0.3), 1.6);
      ctx.fontSize(n, Math.max(minFont, n.text.fontSize * f));
    }
    if (n.text && n.text.fontSize < minFont) ctx.fontSize(n, minFont);

    n.children?.forEach((c) => visit(c, depth + 1));
  };
  visit(ir.root, 0);
}

function tokenOrReport(ctx: Ctx, field: string, value: number, nodeId: string): Operation | undefined {
  const ds = ctx.input.ds;
  if (!ds?.spacingTokens) return undefined; // шкала токенов ещё не просканирована
  const key = ds.spacingTokens[String(value)];
  if (key) return { op: 'bindVariable', nodeId, field, variableKey: key };
  ctx.report.push({ targetId: ctx.targetId, kind: 'no-token', nodeId, message: `нет токена для ${field} ${value}` });
  return undefined;
}

/* ───────────────────────────── App ───────────────────────────── */

function solveApp(ctx: Ctx) {
  const { ir, preset, ds } = ctx.input;
  const { W, H } = ctx;
  const platform = appPlatform(preset) ?? 'ios';
  const safe = preset.safeArea ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const srcW = ir.source.width;
  const minTouch = MIN_TOUCH_TARGET[platform];
  const minFont = ds?.minFontSize.app ?? 12;

  if (ir.root.autoLayout) ctx.ops.push({ op: 'setLayout', nodeId: ir.root.id, mode: 'NONE' });
  const all = (ir.root.children ?? []).filter((c) => c.visible && !ctx.hidden.has(c.id));

  let top = safe.top;
  let bottom = H - safe.bottom;

  for (const e of all.filter((e) => isFullBleed(e, ir) || ctx.role(e) === 'background')) {
    ctx.place(e, 0, 0, W, H);
    ctx.crop(e);
  }
  const statusBar = all.find((e) => ctx.role(e) === 'status-bar');
  if (statusBar) ctx.place(statusBar, 0, 0, W, safe.top || statusBar.bbox.height);

  const navs = all.filter((e) => ctx.role(e) === 'navigation').sort((a, b) => a.bbox.y - b.bbox.y);
  for (const nav of navs) {
    ctx.place(nav, 0, top, W, nav.bbox.height);
    top += nav.bbox.height;
  }
  const tab = all.find((e) => ctx.role(e) === 'tab-bar');
  if (tab) {
    bottom -= tab.bbox.height;
    ctx.place(tab, 0, bottom, W, tab.bbox.height);
  }

  // Контент между барами: сохраняем вертикальные интервалы исходника, ширина — по полям
  const pinned = new Set([statusBar, ...navs, tab].filter(Boolean).map((n) => n!.id));
  const content = all
    .filter((e) => !pinned.has(e.id) && !(isFullBleed(e, ir) || ctx.role(e) === 'background'))
    .sort((a, b) => a.bbox.y - b.bbox.y);
  const srcTop = Math.max(0, ...[...navs, statusBar].filter(Boolean).map((n) => n!.bbox.y + n!.bbox.height));
  let y = top;
  let prevBottom = srcTop;
  const sx = Math.min(1, W / srcW);
  for (const e of content) {
    // Элементы, стоявшие рядом в исходнике, встают в столбик со стандартным отступом
    const gapBefore = e.bbox.y >= prevBottom ? e.bbox.y - prevBottom : 16;
    y += gapBefore;
    const left = e.bbox.x;
    const right = Math.max(0, srcW - (e.bbox.x + e.bbox.width));
    const fullWidth = e.bbox.width >= srcW * 0.85;
    let w: number;
    let x: number;
    if (fullWidth) {
      x = Math.min(left, 24);
      w = W - x - Math.min(right, 24);
    } else if (e.bbox.x + e.bbox.width <= W) {
      x = e.bbox.x;
      w = e.bbox.width;
    } else {
      const m = Math.min(left, 16);
      w = Math.min(e.bbox.width, W - 2 * m);
      x = Math.max(m, Math.min(left * sx, W - w - m));
    }
    const isImage = e.fills?.some((f) => f.type === 'IMAGE' && f.visible) ?? false;
    let h = e.text ? textHeight(e, e.text.fontSize, w) : isImage ? (e.bbox.height * w) / e.bbox.width : e.bbox.height;
    if (ctx.role(e) === 'cta' && h < minTouch) h = minTouch;
    ctx.place(e, x, y, w, h);
    if (isImage) ctx.crop(e);
    if (e.text && e.text.fontSize < minFont) ctx.fontSize(e, minFont);
    y += h;
    prevBottom = Math.max(prevBottom, e.bbox.y + e.bbox.height);
  }
  if (y > bottom) {
    ctx.report.push({ targetId: ctx.targetId, kind: 'overflow', message: `контент выходит за экран на ${r(y - bottom)} pt` });
  }
  ctx.ops.push({ op: 'setSize', nodeId: ir.root.id, width: W, height: H });

}

/** Иконки — только размеры из токенов (spec design-system-integration → Icons from the icon library). */
export function iconSize(target: number, ds?: DesignSystemConfig): number {
  return nearestInScale(target, ds?.iconSizes ?? [], 'down') ?? target;
}

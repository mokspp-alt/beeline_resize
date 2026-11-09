import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG,
  LayoutPlanSchema,
  classify,
  type DesignIR,
  type LayoutPlan,
  type Operation,
  type RoleMap,
  type SizePreset,
} from '@beeline-resize/shared';
import { appScreen, formPage, landing, productBanner, promoBanner } from '../test/fixtures.js';
import { heuristicRoles } from './roles.js';
import { defaultTemplate, planForClass } from './plan.js';
import { analyzeRoles, clearRoleCache, type LlmContext } from './analyze.js';
import { solve, type SolveResult } from './solver.js';
import { validateGeometry } from './validate.js';
import { runAdaptation, type AdaptEvent } from './run.js';
import { RunUsage, UserLimiter } from '../llm/limits.js';
import type { LlmProvider } from '../llm/types.js';

const preset = (id: string): SizePreset => {
  const p = DEFAULT_CATALOG.presets.find((x) => x.id === id);
  if (!p) throw new Error(`нет пресета ${id}`);
  return p;
};

function solveFor(ir: DesignIR, id: string, roles: RoleMap = heuristicRoles(ir)) {
  const p = preset(id);
  const { mode, sizeClass } = classify(p);
  const input = { ir, roles, preset: p, mode, template: defaultTemplate(sizeClass, mode, roles), ai: false };
  const result = solve(input);
  return { input, result, errors: validateGeometry(input, result) };
}

const ops = (plan: LayoutPlan, nodeId: string, op?: Operation['op']) => plan.operations.filter((o) => o.nodeId === nodeId && (!op || o.op === op));
const visible = (r: SolveResult, id: string) => !r.hidden.has(id);

describe('7.2 определение ролей (эвристика) на 5 фикстурах', () => {
  it('баннер: logo, heading, price, cta, hero-image, legal и приоритеты', () => {
    const { roles } = heuristicRoles(promoBanner());
    expect(roles.logo?.role).toBe('logo');
    expect(roles.title?.role).toBe('heading');
    expect(roles.price?.role).toBe('price');
    expect(roles.cta?.role).toBe('cta');
    expect(roles.photo?.role).toBe('hero-image');
    expect(roles.legal?.role).toBe('legal');
    expect(roles.body?.role).toBe('body');
    expect(roles.title!.priority).toBeGreaterThan(roles.legal!.priority);
    expect(roles.cta!.priority).toBeGreaterThan(roles.legal!.priority);
  });

  it('лендинг: навигация, карточки, заголовок, изображение', () => {
    const { roles } = heuristicRoles(landing());
    expect(roles.header?.role).toBe('navigation');
    expect(roles.cards?.role).toBe('list');
    expect(roles.h1?.role).toBe('heading');
  });

  it('экран приложения: status-bar, navigation, tab-bar, cta', () => {
    const { roles } = heuristicRoles(appScreen());
    expect(roles.status?.role).toBe('status-bar');
    expect(roles.nav?.role).toBe('navigation');
    expect(roles.tabs?.role).toBe('tab-bar');
    expect(roles['app-cta']?.role).toBe('cta');
    expect(roles.balance?.role).toBe('card');
  });

  it('форма: form и кнопка отправки', () => {
    const { roles } = heuristicRoles(formPage());
    expect(roles.form?.role).toBe('form');
    expect(roles.submit?.role).toBe('cta');
    expect(roles['form-title']?.role).toBe('heading');
  });

  it('баннер с фото на весь кадр: background с фокусом', () => {
    const { roles } = heuristicRoles(productBanner());
    expect(roles['bg-photo']?.role).toBe('background');
  });
});

describe('7.4 солвер: web', () => {
  it('карточки 1440 → 360: одна колонка на всю ширину, высота по содержимому', () => {
    const { result } = solveFor(landing(), 'web:360xauto');
    expect(result.plan.height).toBe('auto');
    expect(ops(result.plan, 'cards', 'setLayout')).toContainEqual(expect.objectContaining({ mode: 'VERTICAL' }));
    for (const c of ['card1', 'card2', 'card3', 'card4']) {
      expect(ops(result.plan, c, 'setSize')).toContainEqual(expect.objectContaining({ sizingH: 'FILL' }));
    }
    // отступы секций — мобильные
    expect(ops(result.plan, 'cards', 'setLayout')).toContainEqual(expect.objectContaining({ padding: expect.objectContaining({ left: 16, right: 16 }) }));
  });

  it('карточки 1440 → 768: сетка в две колонки', () => {
    const { result } = solveFor(landing(), 'web:768xauto');
    expect(ops(result.plan, 'cards', 'setLayout')).toContainEqual(expect.objectContaining({ mode: 'HORIZONTAL', wrap: true }));
    const w = (768 - 64 - 24) / 2;
    expect(ops(result.plan, 'card1', 'setSize')).toContainEqual(expect.objectContaining({ width: Math.floor(w), sizingH: 'FIXED' }));
  });

  it('герой на мобильном: текст и картинка в столбик, заголовок уменьшен', () => {
    const { result } = solveFor(landing(), 'web:360xauto');
    expect(ops(result.plan, 'hero', 'setLayout')).toContainEqual(expect.objectContaining({ mode: 'VERTICAL' }));
    const h1 = ops(result.plan, 'h1', 'setTextSize')[0] as Extract<Operation, { op: 'setTextSize' }>;
    expect(h1.fontSize).toBeLessThan(64);
    expect(h1.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('1440 → 1440: структура не перестраивается', () => {
    const { result } = solveFor(landing(), 'web:1440xauto');
    expect(ops(result.plan, 'cards', 'setLayout')).toEqual([]);
  });
});

describe('7.4 солвер: app', () => {
  it('Android 360×800 → iPhone 17 402×874: safe area, таб-бар у нижней safe area', () => {
    const { result, errors } = solveFor(appScreen(), 'app-ios:402x874');
    expect(errors).toEqual([]);
    expect(result.plan).toMatchObject({ width: 402, height: 874, mode: 'app' });
    for (const id of ['app-title', 'balance', 'app-cta', 'nav']) {
      expect(result.boxes.get(id)!.y, id).toBeGreaterThanOrEqual(62);
    }
    const tab = result.boxes.get('tabs')!;
    expect(tab.y + tab.height).toBe(874 - 34);
    expect(tab.width).toBe(402);
  });

  it('кнопка не меньше 44 pt на iOS', () => {
    const { result } = solveFor(appScreen(), 'app-ios:375x667');
    expect(result.boxes.get('app-cta')!.height).toBeGreaterThanOrEqual(44);
  });

  it('контент не влезает — переполнение в отчёте, бары на местах', () => {
    const ir = appScreen();
    ir.root.children!.push({ ...ir.root.children![3]!, id: 'long', bbox: { x: 16, y: 400, width: 328, height: 500 }, children: [] });
    const { result } = solveFor(ir, 'app-ios:375x667');
    expect(result.report).toContainEqual(expect.objectContaining({ kind: 'overflow', message: expect.stringMatching(/контент выходит за экран на \d+ pt/) }));
    expect(result.boxes.get('tabs')!.y).toBe(667 - 0 - 56);
  });
});

describe('7.4 солвер: баннеры', () => {
  it('1080×1080 → 728×90: ряд логотип–заголовок–CTA, длинный текст скрыт', () => {
    const { result, errors } = solveFor(promoBanner(), 'banner-display:728x90');
    expect(errors).toEqual([]);
    expect(visible(result, 'logo') && visible(result, 'cta') && visible(result, 'title')).toBe(true);
    expect(result.hidden.has('body')).toBe(true);
    const [logo, title, cta] = ['logo', 'title', 'cta'].map((id) => result.boxes.get(id)!);
    expect(logo!.x).toBeLessThan(title!.x);
    expect(title!.x).toBeLessThan(cta!.x);
    expect(result.plan.composition).toBe('row');
  });

  it('160×600: вертикальный стек по приоритету, logo и CTA видимы', () => {
    const { result, errors } = solveFor(promoBanner(), 'banner-display:160x600');
    expect(errors).toEqual([]);
    expect(visible(result, 'logo') && visible(result, 'cta')).toBe(true);
    const logo = result.boxes.get('logo')!;
    const cta = result.boxes.get('cta')!;
    expect(logo.y).toBeLessThan(cta.y);
  });

  it('320×50: сноска скрыта с причиной про минимальный размер', () => {
    const { result } = solveFor(promoBanner(), 'banner-display:320x50');
    expect(result.hidden.has('legal')).toBe(true);
    expect(result.report).toContainEqual(expect.objectContaining({ kind: 'hidden', nodeId: 'legal', message: 'legal скрыт: не помещается при минимальном размере 10' }));
    expect(visible(result, 'logo') && visible(result, 'cta')).toBe(true);
  });

  it('текст не меньше минимального кегля', () => {
    for (const id of ['banner-display:320x50', 'banner-display:160x600', 'banner-display:300x250']) {
      const { result } = solveFor(promoBanner(), id);
      for (const o of result.plan.operations) if (o.op === 'setTextSize') expect(o.fontSize, id).toBeGreaterThanOrEqual(10);
    }
  });

  it('1200×630 → 1080×1920: фон кадрируется по фокусной точке товара', () => {
    const ir = productBanner();
    const roles = heuristicRoles(ir);
    roles.roles['bg-photo'] = { role: 'background', priority: 50, focal: { x: 0.8, y: 0.5 } };
    const { result, errors } = solveFor(ir, 'banner-social:1080x1920', roles);
    expect(errors).toEqual([]);
    expect(ops(result.plan, 'bg-photo', 'crop')).toEqual([{ op: 'crop', nodeId: 'bg-photo', focal: { x: 0.8, y: 0.5 } }]);
    expect(result.boxes.get('bg-photo')).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('все дисплейные и социальные форматы: logo и CTA видимы, геометрия валидна', () => {
    for (const p of DEFAULT_CATALOG.presets.filter((p) => p.group.startsWith('banner-'))) {
      const { result, errors } = solveFor(promoBanner(), p.id);
      expect(errors, p.id).toEqual([]);
      expect(visible(result, 'logo') && visible(result, 'cta'), p.id).toBe(true);
      expect(LayoutPlanSchema.safeParse(result.plan).success, p.id).toBe(true);
    }
  });
});

describe('весь каталог × все фикстуры', () => {
  it('солвер не падает, планы проходят схему', () => {
    for (const ir of [promoBanner(), landing(), appScreen(), formPage(), productBanner()]) {
      for (const p of DEFAULT_CATALOG.presets) {
        const { result } = solveFor(ir, p.id);
        expect(LayoutPlanSchema.safeParse(result.plan).success, `${ir.source.name} → ${p.id}`).toBe(true);
      }
    }
  });
});

/* ───────────── LLM-шаги, валидация и фолбэк ───────────── */

function fakeProvider(answer: (system: string) => string | 'hang'): LlmProvider & { calls: number } {
  const p = {
    name: 'fake' as const,
    model: 'fake',
    supportsImages: false,
    calls: 0,
    complete: async (r: { system: string }) => {
      p.calls++;
      const a = answer(r.system);
      if (a === 'hang') return new Promise<never>(() => {});
      return { text: a, usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
  return p;
}

const ctx = (provider?: LlmProvider, timeoutMs = 1000): LlmContext => ({
  ...(provider ? { provider } : {}),
  limiter: new UserLimiter(4),
  user: 'u',
  timeoutMs,
  usage: new RunUsage(),
});

const goodPlan = (ids: string[]) =>
  JSON.stringify({ composition: 'row', columns: null, order: ids, hide: [], focal: [], containers: [], notes: [] });

describe('7.3 / 7.5 планирование с LLM, валидация и фолбэк', () => {
  beforeEach(() => clearRoleCache());

  it('роли от модели объединяются с эвристикой и кэшируются', async () => {
    const ir = promoBanner();
    const p = fakeProvider(() =>
      JSON.stringify({ elements: [{ nodeId: 'photo', role: 'hero-image', priority: 75, group: null, focal: { x: 0.7, y: 0.4 } }] }),
    );
    const a = await analyzeRoles(ir, ctx(p));
    expect(a.ai).toBe(true);
    expect(a.roleMap.roles.photo).toMatchObject({ role: 'hero-image', focal: { x: 0.7, y: 0.4 } });
    expect(a.roleMap.roles.cta?.role).toBe('cta');
    await analyzeRoles(ir, ctx(p));
    expect(p.calls).toBe(1);
  });

  it('план модели проходит схему и валидацию', async () => {
    const ir = promoBanner();
    const roles = heuristicRoles(ir);
    const r = await planForClass(ir, roles, 'banner:strip', 'banner', [{ width: 728, height: 90 }], ctx(fakeProvider(() => goodPlan(['logo', 'title', 'cta']))));
    expect(r.ai).toBe(true);
    expect(r.template).toMatchObject({ composition: 'row', order: ['logo', 'title', 'cta'] });
  });

  it('ссылка на несуществующий элемент → план отклонён, детерминированный фолбэк', async () => {
    const ir = promoBanner();
    const roles = heuristicRoles(ir);
    const r = await planForClass(ir, roles, 'banner:strip', 'banner', [{ width: 728, height: 90 }], ctx(fakeProvider(() => goodPlan(['logo', 'ghost-42']))));
    expect(r.ai).toBe(false);
    expect(r.reason).toBe('без AI: невалидный ответ модели');
    expect(r.template).toEqual(defaultTemplate('banner:strip', 'banner', roles));
  });

  it('модель пытается скрыть CTA → план отклонён', async () => {
    const ir = promoBanner();
    const bad = JSON.stringify({ composition: 'row', columns: null, order: [], hide: [{ nodeId: 'cta', reason: 'мешает' }], focal: [], containers: [], notes: [] });
    const r = await planForClass(ir, heuristicRoles(ir), 'banner:strip', 'banner', [{ width: 728, height: 90 }], ctx(fakeProvider(() => bad)));
    expect(r.ai).toBe(false);
  });

  it('таймаут провайдера → фолбэк, отчёт «без AI: таймаут провайдера»', async () => {
    const events: AdaptEvent[] = [];
    await runAdaptation(
      { ir: promoBanner(), targets: [preset('banner-display:300x250')] },
      { provider: fakeProvider(() => 'hang'), limiter: new UserLimiter(4), policy: { allowPreview: true, maskTexts: false, confidentialProviders: [] }, timeoutMs: 30, user: 'u' },
      (e) => events.push(e),
    );
    const plan = events.find((e) => e.type === 'plan') as Extract<AdaptEvent, { type: 'plan' }>;
    expect(plan.plan.ai).toBe(false);
    expect(plan.report[0]).toMatchObject({ kind: 'fallback', message: 'без AI: таймаут провайдера' });
  });

  it('конфиденциальный файл и недопущенный провайдер → без AI, провайдер не вызывается', async () => {
    const p = fakeProvider(() => '{}');
    const events: AdaptEvent[] = [];
    await runAdaptation(
      { ir: promoBanner(), targets: [preset('banner-display:300x250')], confidential: true },
      { provider: p, limiter: new UserLimiter(4), policy: { allowPreview: true, maskTexts: false, confidentialProviders: ['gigachat'] }, timeoutMs: 1000, user: 'u' },
      (e) => events.push(e),
    );
    expect(p.calls).toBe(0);
    const plan = events.find((e) => e.type === 'plan') as Extract<AdaptEvent, { type: 'plan' }>;
    expect(plan.plan.fallbackReason).toMatch(/не допущен для конфиденциальных файлов/);
  });

  it('один вызов планирования на класс: 300×250 и 336×280 делят план', async () => {
    const p = fakeProvider((system) =>
      system.includes('Определи смысловую роль') ? JSON.stringify({ elements: [] }) : goodPlan(['logo', 'title', 'cta']),
    );
    const events: AdaptEvent[] = [];
    await runAdaptation(
      { ir: promoBanner(), targets: [preset('banner-display:300x250'), preset('banner-display:336x280')] },
      { provider: p, limiter: new UserLimiter(4), policy: { allowPreview: true, maskTexts: false, confidentialProviders: [] }, timeoutMs: 1000, user: 'u' },
      (e) => events.push(e),
    );
    // один вызов анализа (пустой ответ → эвристика) + один план на класс для обоих размеров
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(2);
    expect(p.calls).toBe(2);
  });
});

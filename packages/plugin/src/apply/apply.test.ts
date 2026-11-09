import { describe, expect, it } from 'vitest';
import type { DesignSystemConfig, LayoutPlan, ReportItem } from '@beeline-resize/shared';
import { applyPlan, type ApplyDeps } from './apply.js';
import { cropTransform, visibleWindow } from './crop.js';
import { resultName, nextVersionName } from './naming.js';
import { placeResults, intersects, GAP } from './placement.js';
import { fingerprint } from './fingerprint.js';
import { libraryStatus, summarize } from '../ds/library.js';
import { FNode, MIXED, page } from '../test/fake-scene.js';

function source() {
  const title = new FNode('TEXT', 'Title', { characters: 'Безлимит', fontSize: 72, x: 64, y: 200, width: 560, height: 180, textStyleId: 'S:h1' });
  const label = new FNode('TEXT', 'Label', { characters: 'Подключить', fontSize: 24 });
  const button = new FNode(
    'INSTANCE',
    'Button',
    {
      x: 64,
      y: 680,
      width: 280,
      height: 72,
      mainComponent: { key: 'k-web-button', name: 'Size=L' },
      componentProperties: { Size: { type: 'VARIANT', value: 'L' }, 'Label#1:0': { type: 'TEXT', value: 'Подключить' } },
    },
    [label],
  );
  const photo = new FNode('RECTANGLE', 'Photo', {
    x: 0,
    y: 0,
    width: 1200,
    height: 630,
    fills: [{ type: 'IMAGE', imageHash: 'h-phone', scaleMode: 'FILL', boundVariables: {} }],
  });
  const bg = new FNode('RECTANGLE', 'Fill', { fills: [{ type: 'SOLID', color: { r: 1, g: 0.8, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:yellow' } } }] });
  const root = new FNode('FRAME', 'Promo', { x: 0, y: 0, width: 1080, height: 1080, layoutMode: 'VERTICAL' }, [bg, photo, title, button]);
  page(root);
  return { root, title, button, label, photo, bg };
}

const ids = (s: ReturnType<typeof source>) => s;

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps & { fonts: string[] } {
  const fonts: string[] = [];
  return {
    fonts,
    mixed: MIXED,
    loadFont: async (f) => void fonts.push(`${f.family}/${f.style}`),
    importComponent: async (key) =>
      ({ key, name: 'App Button', props: { 'Label#9:0': { type: 'TEXT', value: '' }, Size: { type: 'VARIANT', value: 'M' } } }) as unknown as ComponentNode,
    importVariable: async (key) => ({ key }) as unknown as Variable,
    collectionForKey: async (key) =>
      key === 'col-bp'
        ? ({ key, modes: [{ name: 'Mobile', modeId: 'm1' }, { name: 'Desktop', modeId: 'm3' }] } as unknown as VariableCollection)
        : null,
    importStyle: async (key) => ({ id: `S:${key}` }) as unknown as BaseStyle,
    imageSize: async () => ({ width: 1200, height: 630 }),
    ...over,
  };
}

const plan = (over: Partial<LayoutPlan>): LayoutPlan => ({
  targetId: 'banner-display:300x250',
  width: 300,
  height: 250,
  mode: 'banner',
  sizeClass: 'banner:square',
  composition: 'stack',
  variableModes: {},
  operations: [],
  ai: true,
  ...over,
});

const run = async (s: ReturnType<typeof source>, p: LayoutPlan, ds?: DesignSystemConfig, d = deps(), report: ReportItem[] = []) =>
  applyPlan(s.root as unknown as FrameNode, p, report, ds, d);

const asF = (n: unknown) => n as FNode;

describe('8.1 применение плана', () => {
  it('исходник не изменён, результат — редактируемая копия нужного размера', async () => {
    const s = source();
    const before = fingerprint(s.root);
    const r = await run(
      s,
      plan({
        operations: [
          { op: 'setLayout', nodeId: s.root.id, mode: 'NONE' },
          { op: 'setPosition', nodeId: s.title.id, x: 16, y: 40 },
          { op: 'setSize', nodeId: s.title.id, width: 268 },
          { op: 'hide', nodeId: s.photo.id, reason: 'не помещается' },
        ],
      }),
    );
    expect(fingerprint(s.root)).toBe(before);
    const f = asF(r.frame);
    expect(f).not.toBe(s.root);
    expect([f.width, f.height, f.clipsContent]).toEqual([300, 250, true]);
    const title = asF(r.nodeMap.get(s.title.id));
    expect([title.type, title.x, title.y, title.width, title.textAutoResize]).toEqual(['TEXT', 16, 40, 268, 'HEIGHT']);
    expect(asF(r.nodeMap.get(s.photo.id)).visible).toBe(false);
    // кнопка — по-прежнему инстанс, цвет — по-прежнему привязан к переменной
    expect(asF(r.nodeMap.get(s.button.id)).type).toBe('INSTANCE');
    expect((asF(r.nodeMap.get(s.bg.id)).fills[0] as any).boundVariables.color.id).toBe('V:yellow');
  });

  it('моды переменных: Web-брейкпоинт Mobile', async () => {
    const s = source();
    const r = await run(s, plan({ mode: 'web', height: 'auto', variableModes: { 'col-bp': 'Mobile' } }));
    expect(asF(r.frame).explicitModes).toEqual({ 'col-bp': 'm1' });
    expect(asF(r.frame).primaryAxisSizingMode).toBe('AUTO');
  });

  it('мод не найден — в отчёте library-missing, запуск продолжается', async () => {
    const s = source();
    const r = await run(s, plan({ variableModes: { 'col-missing': 'iOS' } }));
    expect(r.report).toContainEqual(expect.objectContaining({ kind: 'library-missing' }));
  });

  it('размер кнопки: swapVariant с тем же текстом', async () => {
    const s = source();
    const r = await run(s, plan({ operations: [{ op: 'swapVariant', nodeId: s.button.id, props: { Size: 'M' } }] }));
    const btn = asF(r.nodeMap.get(s.button.id));
    expect(btn.componentProperties.Size!.value).toBe('M');
    expect(btn.componentProperties['Label#1:0']!.value).toBe('Подключить');
  });

  it('замена WEB → APP: текстовые свойства с совпадающими именами переносятся', async () => {
    const s = source();
    const r = await run(s, plan({ operations: [{ op: 'swapComponent', nodeId: s.button.id, componentKey: 'k-app-button' }] }));
    const btn = asF(r.nodeMap.get(s.button.id));
    expect(btn.mainComponent!.key).toBe('k-app-button');
    expect(btn.componentProperties['Label#9:0']!.value).toBe('Подключить');
  });

  it('операции ДС выполняются раньше раскладки', async () => {
    const s = source();
    const order: string[] = [];
    const d = deps({
      importComponent: async (key) => {
        order.push('swap');
        return { key, name: 'x', props: {} } as unknown as ComponentNode;
      },
    });
    await run(s, plan({ operations: [{ op: 'setPosition', nodeId: s.button.id, x: 1, y: 1 }, { op: 'swapComponent', nodeId: s.button.id, componentKey: 'k' }] }), undefined, d);
    expect(order).toEqual(['swap']);
  });

  it('кегль: стиль Carnica с тем же размером → setTextStyleIdAsync, шрифты загружены', async () => {
    const s = source();
    const ds = { textStyles: [{ key: 'ts-h3', name: 'Heading/H3', fontSize: 32 }] } as unknown as DesignSystemConfig;
    const d = deps();
    const r = await run(s, plan({ operations: [{ op: 'setTextSize', nodeId: s.title.id, fontSize: 32 }] }), ds, d);
    expect(asF(r.nodeMap.get(s.title.id)).textStyleId).toBe('S:ts-h3');
    expect(d.fonts).toEqual(['Beeline Sans/Regular']);
    expect(r.report.filter((x) => x.kind === 'no-token')).toEqual([]);
  });

  it('кегль без токена → число и отклонение «нет токена» в отчёте', async () => {
    const s = source();
    const ds = { textStyles: [{ key: 'ts-h3', name: 'Heading/H3', fontSize: 32 }] } as unknown as DesignSystemConfig;
    const r = await run(s, plan({ operations: [{ op: 'setTextSize', nodeId: s.title.id, fontSize: 13 }] }), ds);
    expect(asF(r.nodeMap.get(s.title.id)).fontSize).toBe(13);
    expect(r.report).toContainEqual(expect.objectContaining({ kind: 'no-token', message: 'нет токена для font-size 13' }));
  });

  it('отступ из токена: bindVariable', async () => {
    const s = source();
    const r = await run(s, plan({ operations: [{ op: 'bindVariable', nodeId: s.root.id, field: 'itemSpacing', variableKey: 'var-spacing-16' }] }));
    expect(asF(r.frame).bound).toEqual({ itemSpacing: 'var-spacing-16' });
  });

  it('кадрирование: товар справа остаётся в кадре 1080×1920', async () => {
    const s = source();
    const r = await run(
      s,
      plan({
        width: 1080,
        height: 1920,
        operations: [
          { op: 'setSize', nodeId: s.photo.id, width: 1080, height: 1920 },
          { op: 'crop', nodeId: s.photo.id, focal: { x: 0.8, y: 0.5 } },
        ],
      }),
    );
    const paint = asF(r.nodeMap.get(s.photo.id)).fills[0] as { scaleMode: string; imageTransform: any };
    expect(paint.scaleMode).toBe('CROP');
    const w = visibleWindow(paint.imageTransform);
    // телефон занимает 0.72–0.88 ширины фото
    expect(w.x0).toBeLessThanOrEqual(0.72);
    expect(w.x1).toBeGreaterThanOrEqual(0.88);
  });

  it('ошибка одной операции не роняет запуск, а попадает в отчёт', async () => {
    const s = source();
    const r = await run(s, plan({ operations: [{ op: 'setSize', nodeId: s.label.id, width: 10, height: 10 }, { op: 'hide', nodeId: s.photo.id, reason: 'x' }] }));
    expect(r.report).toContainEqual(expect.objectContaining({ kind: 'warning', message: expect.stringContaining('setSize для «Label» не применена') }));
    expect(asF(r.nodeMap.get(s.photo.id)).visible).toBe(false);
  });

  it('nodeId в отчёте указывают на слои результата (для выделения по клику)', async () => {
    const s = source();
    const r = await run(s, plan({}), undefined, deps(), [{ targetId: 't', kind: 'hidden', nodeId: s.photo.id, message: 'legal скрыт' }]);
    expect(r.report[0]!.nodeId).toBe(r.nodeMap.get(s.photo.id)!.id);
    expect(r.report[0]!.nodeId).not.toBe(s.photo.id);
  });

  it('reorder и FILL внутри auto layout', async () => {
    const s = source();
    const r = await run(
      s,
      plan({
        mode: 'web',
        height: 'auto',
        operations: [
          { op: 'reorder', nodeId: s.root.id, order: [s.title.id, s.button.id, s.photo.id, s.bg.id] },
          { op: 'setSize', nodeId: s.photo.id, sizingH: 'FILL' },
        ],
      }),
    );
    expect(asF(r.frame).children.map((c) => c.name)).toEqual(['Title', 'Button', 'Photo', 'Fill']);
    expect(asF(r.nodeMap.get(s.photo.id)).layoutSizingHorizontal).toBe('FILL');
  });
});

describe('кадрирование', () => {
  it('квадрат из широкого фото с фокусом по центру', () => {
    const w = visibleWindow(cropTransform(500, 500, 1000, 500, { x: 0.5, y: 0.5 }));
    expect(w).toEqual({ x0: 0.25, x1: 0.75, y0: 0, y1: 1 });
  });
  it('фокус у края не выводит окно за изображение', () => {
    const w = visibleWindow(cropTransform(500, 500, 1000, 500, { x: 1, y: 0.5 }));
    expect(w.x1).toBeCloseTo(1);
  });
});

describe('8.2 имена и размещение', () => {
  it('имена по шаблону без дублирования размера', () => {
    expect(resultName('Promo', { group: 'app-ios', name: 'iPhone 16', width: 393, height: 852 })).toBe('Promo / App iOS / iPhone 16 393×852');
    expect(resultName('Promo', { group: 'web', name: 'Web 360', width: 360, height: 'auto' })).toBe('Promo / Web / Web 360×auto');
    expect(resultName('Promo', { group: 'banner-display', name: 'Leaderboard 728×90', width: 728, height: 90 })).toBe('Promo / Баннеры / Leaderboard 728×90');
    expect(resultName('Promo', { group: 'banner-display', name: '300×300', width: 300, height: 300 })).toBe('Promo / Баннеры / 300×300');
  });

  it('версии: v2, затем v3', () => {
    expect(nextVersionName('Promo / Баннеры / 300×250', [])).toBe('Promo / Баннеры / 300×250 v2');
    expect(nextVersionName('Promo / Баннеры / 300×250 v2', ['Promo / Баннеры / 300×250 v2'])).toBe('Promo / Баннеры / 300×250 v3');
  });

  it('ряды по группам справа от исходника с отступом 100', () => {
    const src = { x: 0, y: 0, width: 1080, height: 1080 };
    const out = placeResults(src, [
      { id: 'a', group: 'banner-display' as const, width: 300, height: 250 },
      { id: 'b', group: 'app-ios' as const, width: 393, height: 852 },
      { id: 'c', group: 'banner-display' as const, width: 728, height: 90 },
    ], []);
    const by = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(by.b).toMatchObject({ x: 1180, y: 0 });
    expect(by.a).toMatchObject({ x: 1180, y: 852 + GAP });
    expect(by.c).toMatchObject({ x: 1180 + 300 + GAP, y: 852 + GAP });
  });

  it('свободное место: не перекрывает существующие фреймы', () => {
    const src = { x: 0, y: 0, width: 500, height: 500 };
    const occupied = [{ x: 600, y: 0, width: 400, height: 700 }];
    const out = placeResults(src, [{ group: 'web' as const, width: 360, height: 800 }], occupied);
    expect(intersects(out[0]!, occupied[0]!)).toBe(false);
    expect(out[0]!.x).toBe(600);
  });
});

describe('8.3 отпечаток «изменён вручную»', () => {
  it('перемещение фрейма — не изменение; правка слоя — изменение', () => {
    const s = source();
    const fp = fingerprint(s.root);
    s.root.x = 5000;
    expect(fingerprint(s.root)).toBe(fp);
    s.title.characters = 'Другой текст';
    expect(fingerprint(s.root)).not.toBe(fp);
  });
});

describe('5.2 статус библиотек Carnica', () => {
  const ds = {
    libraries: {
      colors: { name: '01_Carnica-colors-2.0', fileKey: 'a' },
      typography: { name: '02_Carnica-typography', fileKey: 'b' },
      sizes: { name: '03_Carnica-sizes', fileKey: 'c' },
      icons: { name: '04_Carnica-icons', fileKey: 'd', probeComponentKey: 'p-icons' },
      'ui-kit-app': { name: '05_Carnica-UI-kit-APP', fileKey: 'e', probeComponentKey: 'p-app' },
      'ui-kit-web': { name: '06_Carnica-UI-kit-WEB', fileKey: 'f', probeComponentKey: 'p-web' },
    },
  } as unknown as DesignSystemConfig;
  const cols = (names: string[]) => async () => names.map((n, i) => ({ key: `k${i}`, name: 'c', libraryName: n }));

  it('все шесть включены → «Carnica подключена»', async () => {
    const st = await libraryStatus(ds, { availableCollections: cols(['01_Carnica-colors-2.0', '02_Carnica-typography', '03_Carnica-sizes']), probeComponent: async () => true });
    expect(st.every((s) => s.state === 'enabled')).toBe(true);
    expect(summarize(st)).toMatchObject({ connected: true, message: 'Carnica подключена', missingKits: [] });
  });

  it('не включён UI-kit WEB → статус «missing», Web без вариантов', async () => {
    const st = await libraryStatus(ds, {
      availableCollections: cols(['01_Carnica-colors-2.0', '02_Carnica-typography', '03_Carnica-sizes']),
      probeComponent: async (k) => k !== 'p-web',
    });
    expect(st.find((s) => s.role === 'ui-kit-web')!.state).toBe('missing');
    const sum = summarize(st);
    expect(sum.missingKits).toEqual(['web']);
    expect(sum.message).toContain('06_Carnica-UI-kit-WEB');
    expect(sum.message).toContain('Assets → Libraries');
  });

  it('не включены токены → нужно подтверждение', async () => {
    const st = await libraryStatus(ds, { availableCollections: cols([]), probeComponent: async () => true });
    expect(summarize(st).tokensMissing).toBe(true);
  });
});

void ids;

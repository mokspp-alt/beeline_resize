import { describe, expect, it } from 'vitest';
import { DesignIRSchema } from '@beeline-resize/shared';
import { checkSelection, SELECTION_MESSAGE } from './selection.js';
import { captureDesign, type CaptureDeps } from './serialize.js';
import { collectWarnings, needsConfirmation } from './warnings.js';
import { buildSourcePayload, previewScale, toBase64 } from './preview.js';
import { findMissingFonts } from './fonts.js';
import { MIXED, layout, node, page, text, type FakeNode } from '../test/fake-figma.js';

const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps => ({
  mixed: MIXED,
  getVariable: async (id) =>
    id === 'V:primary'
      ? { id, key: 'key-primary', name: 'color/primary', variableCollectionId: 'C:colors', remote: true }
      : id === 'V:gap16'
        ? { id, key: 'key-gap16', name: 'spacing/16', variableCollectionId: 'C:sizes', remote: true }
        : null,
  getCollection: async (id) =>
    id === 'C:colors'
      ? { id, key: 'col-colors', name: 'Colors', remote: true }
      : id === 'C:sizes'
        ? { id, key: 'col-sizes', name: 'Sizes', remote: true }
        : null,
  getStyle: async (id) => (id === 'S:h1' ? { id, key: 'style-h1', name: 'Heading/H1', remote: true } : null),
  getMainComponent: async (i) => ((i as unknown as FakeNode).main as ComponentNode) ?? null,
  libraryNameForCollectionKey: (k) =>
    ({ 'col-colors': '01_Carnica-colors-2.0', 'col-sizes': '03_Carnica-sizes' })[k],
  libraryNameForComponentKey: (k) => (k === 'set-button' ? '06_Carnica-UI-kit-WEB' : undefined),
  ...over,
});

const asScene = (n: FakeNode) => n as unknown as SceneNode;

describe('checkSelection', () => {
  const frame = node('FRAME', { name: 'Landing', width: 1440, height: 900 });
  const title = text('Привет');
  frame.children = [title];
  title.parent = frame;
  page([frame]);

  it('один фрейм верхнего уровня — ok', () => {
    const r = checkSelection([frame]);
    expect(r.ok).toBe(true);
  });

  it('пустое и множественное выделение', () => {
    const other = node('FRAME');
    page([other]);
    expect(checkSelection([])).toMatchObject({ ok: false, code: 'empty', message: SELECTION_MESSAGE });
    expect(checkSelection([frame, other])).toMatchObject({ ok: false, code: 'multiple', message: SELECTION_MESSAGE });
  });

  it('текстовый слой — предлагает родительский фрейм', () => {
    const r = checkSelection([title]);
    expect(r).toMatchObject({ ok: false, code: 'not-frame' });
    expect(r.ok === false && r.code === 'not-frame' && r.suggestion?.name).toBe('Landing');
  });

  it('группа верхнего уровня — не фрейм', () => {
    const g = node('GROUP', { name: 'Group' });
    page([g]);
    expect(checkSelection([g])).toMatchObject({ ok: false, code: 'not-frame' });
  });

  it('вложенный фрейм не считается исходником', () => {
    const inner = node('FRAME', { name: 'Inner' });
    const outer = node('FRAME', { name: 'Outer' }, [inner]);
    page([outer]);
    const r = checkSelection([inner]);
    expect(r.ok === false && r.code === 'not-frame' && r.suggestion?.name).toBe('Outer');
  });
});

function buildSource() {
  const heading = text('Безлимит на всё', {
    id: '1:2',
    name: 'Title',
    x: 80,
    y: 120,
    width: 920,
    height: 160,
    fontSize: 72,
    fontName: { family: 'Beeline Sans', style: 'Bold' },
    lineHeight: { unit: 'PERCENT', value: 110 },
    textStyleId: 'S:h1',
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:primary' } } }],
    constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
  });

  const set = { type: 'COMPONENT_SET', key: 'set-button', name: 'Button' };
  const main = { type: 'COMPONENT', key: 'btn-l', name: 'Size=L, State=Default', remote: true, parent: set };
  const button = node('INSTANCE', {
    id: '1:5',
    name: 'Button',
    x: 0,
    y: 0,
    width: 280,
    height: 64,
    main,
    componentProperties: {
      Size: { type: 'VARIANT', value: 'L' },
      State: { type: 'VARIANT', value: 'Default' },
      'Label#12:0': { type: 'TEXT', value: 'Подключить' },
    },
    overrides: [{ id: 'I1:5;2:1', overriddenFields: ['characters'] }],
    layoutPositioning: 'AUTO',
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'FIXED',
    layoutGrow: 0,
  });

  const row = node(
    'FRAME',
    {
      id: '1:4',
      name: 'Actions',
      x: 80,
      y: 880,
      width: 600,
      height: 64,
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'NO_WRAP',
      itemSpacing: 16,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'FIXED',
      boundVariables: { itemSpacing: { type: 'VARIABLE_ALIAS', id: 'V:gap16' } },
      constraints: { horizontal: 'MIN', vertical: 'MAX' },
      fills: [],
    },
    [button],
  );

  const photo = node('RECTANGLE', {
    id: '1:3',
    name: 'Photo',
    x: 600,
    y: 300,
    width: 400,
    height: 500,
    fills: [{ type: 'IMAGE', imageHash: 'abc123', scaleMode: 'FILL', opacity: 1 }],
    constraints: { horizontal: 'MAX', vertical: 'CENTER' },
  });

  const root = node('FRAME', { id: '1:1', name: 'Promo', x: 500, y: 200, width: 1080, height: 1080, fills: [] }, [heading, photo, row]);
  page([root]);
  layout(root);
  return root;
}

describe('captureDesign', () => {
  it('golden: валидный DesignIR с геометрией относительно корня', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps(), { pageName: 'Page 1' });
    expect(DesignIRSchema.safeParse(ir).success).toBe(true);
    expect(ir.source).toEqual({ nodeId: '1:1', name: 'Promo', width: 1080, height: 1080, pageName: 'Page 1' });
    expect(ir.root.children!.map((c) => c.id)).toEqual(['1:2', '1:3', '1:4']);
    expect(ir.root.children![0]!.bbox).toEqual({ x: 80, y: 120, width: 920, height: 160 });
    expect(ir.root.children![2]!.children![0]!.bbox).toEqual({ x: 80, y: 880, width: 280, height: 64 });
    expect(ir.fonts).toEqual([{ family: 'Beeline Sans', style: 'Bold' }]);
  });

  it('auto layout и constraints сохраняются', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    const row = ir.root.children![2]!;
    expect(row.autoLayout).toMatchObject({ mode: 'HORIZONTAL', itemSpacing: 16, padding: { top: 0, right: 0, bottom: 0, left: 0 }, primarySizing: 'AUTO' });
    expect(ir.root.children![0]!.constraints).toEqual({ horizontal: 'STRETCH', vertical: 'MIN' });
    expect(row.children![0]!.childLayout).toEqual({ positioning: 'AUTO', sizingH: 'HUG', sizingV: 'FIXED', grow: 0 });
  });

  it('привязки к дизайн-системе сохраняются (переменные, стиль, библиотека)', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    const title = ir.root.children![0]!;
    expect(title.fills![0]!.variable).toEqual({
      id: 'V:primary',
      key: 'key-primary',
      name: 'color/primary',
      collectionName: 'Colors',
      libraryName: '01_Carnica-colors-2.0',
    });
    expect(title.text!.textStyle).toMatchObject({ key: 'style-h1', name: 'Heading/H1' });
    expect(title.text!.lineHeight).toBe(79.2);
    expect(ir.root.children![2]!.boundVariables!.itemSpacing).toMatchObject({ name: 'spacing/16', libraryName: '03_Carnica-sizes' });
  });

  it('инстанс: ключ, вариант, свойства и overrides', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    const btn = ir.root.children![2]!.children![0]!;
    expect(btn.component).toEqual({
      key: 'btn-l',
      name: 'Size=L, State=Default',
      componentSetKey: 'set-button',
      componentSetName: 'Button',
      libraryName: '06_Carnica-UI-kit-WEB',
      isRemote: true,
      variantProps: { Size: 'L', State: 'Default' },
      componentProps: { Label: 'Подключить' },
      overriddenNodeIds: ['I1:5;2:1'],
    });
  });

  it('изображение: hash и scaleMode', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    expect(ir.root.children![1]!.fills).toEqual([{ type: 'IMAGE', visible: true, opacity: 1, imageHash: 'abc123', scaleMode: 'FILL' }]);
  });
});

describe('превью', () => {
  it('масштаб ≤1600 по длинной стороне', () => {
    expect(previewScale(1080, 1920)).toBeCloseTo(1600 / 1920);
    expect(previewScale(300, 250)).toBe(1);
  });

  it('при выключенном флаге превью не попадает в запрос и не снимается', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    let taken = false;
    const payload = await buildSourcePayload(ir, { allowPreview: false, maskTexts: false }, async () => {
      taken = true;
      return new Uint8Array([1, 2, 3]);
    });
    expect(payload).toEqual({ ir });
    expect('preview' in payload).toBe(false);
    expect(taken).toBe(false);
  });

  it('при включённом флаге превью передаётся в base64', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    const payload = await buildSourcePayload(ir, { allowPreview: true, maskTexts: false }, async () => new Uint8Array([104, 105]));
    expect(payload.preview).toBe('aGk=');
  });

  it('toBase64 совпадает с Buffer', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37) & 255);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('предупреждения', () => {
  it('отсутствующий шрифт — с именем, слоями и подтверждением', () => {
    const t1 = text('a', { id: 't1', hasMissingFont: true, fontName: { family: 'Beeline Sans', style: 'Black' } });
    const t2 = text('b', { id: 't2', hasMissingFont: true, fontName: { family: 'Beeline Sans', style: 'Black' } });
    const root = node('FRAME', { id: 'r' }, [t1, t2]);
    const missing = findMissingFonts(asScene(root), MIXED);
    expect(missing.get('Beeline Sans::Black')).toEqual(['t1', 't2']);

    const ir = { version: 1 as const, source: { nodeId: 'r', name: 'r', width: 100, height: 100 }, fonts: [], root: { id: 'r', name: 'r', type: 'FRAME' as const, visible: true, bbox: { x: 0, y: 0, width: 100, height: 100 }, autoLayout: { mode: 'VERTICAL' as const, wrap: false, itemSpacing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, primaryAxisAlign: 'MIN' as const, counterAxisAlign: 'MIN' as const, primarySizing: 'AUTO' as const, counterSizing: 'FIXED' as const } } };
    const w = collectWarnings({ ir, missingFonts: missing });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'missing-font', font: 'Beeline Sans Black', nodeIds: ['t1', 't2'], requiresConfirm: true });
    expect(needsConfirmation(w)).toBe(true);
  });

  it('нет constraints, выход за границы, текст в растре', async () => {
    const a = node('RECTANGLE', { id: 'a', x: 10, y: 10, width: 50, height: 50, constraints: { horizontal: 'MIN', vertical: 'MIN' } });
    const b = node('RECTANGLE', { id: 'b', name: 'Заголовок картинкой', x: 60, y: 900, width: 200, height: 300, constraints: { horizontal: 'MIN', vertical: 'MIN' }, fills: [{ type: 'IMAGE', imageHash: 'h', scaleMode: 'FILL' }] });
    const root = node('FRAME', { id: 'r', name: 'Banner', width: 1000, height: 1000, fills: [] }, [a, b]);
    page([root]);
    layout(root);
    const ir = await captureDesign(asScene(root), deps());
    const codes = collectWarnings({ ir, missingFonts: new Map() }).map((w) => w.code).sort();
    expect(codes).toEqual(['no-constraints', 'out-of-bounds', 'raster-text']);
  });

  it('аккуратный исходник без предупреждений', async () => {
    const ir = await captureDesign(asScene(buildSource()), deps());
    expect(collectWarnings({ ir, missingFonts: new Map() })).toEqual([]);
  });
});

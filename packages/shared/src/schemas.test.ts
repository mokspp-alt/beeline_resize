import { describe, expect, it } from 'vitest';
import {
  DesignIRSchema,
  LayoutPlanSchema,
  PlanTemplateSchema,
  RoleMapSchema,
  indexNodes,
  planTemplateJsonSchema,
  roleMapJsonSchema,
  type DesignIR,
} from './index.js';

const banner: DesignIR = {
  version: 1,
  source: { nodeId: '1:1', name: 'Promo', width: 1080, height: 1080 },
  fonts: [{ family: 'Beeline Sans', style: 'Bold' }],
  root: {
    id: '1:1',
    name: 'Promo',
    type: 'FRAME',
    visible: true,
    bbox: { x: 0, y: 0, width: 1080, height: 1080 },
    children: [
      {
        id: '1:2',
        name: 'Title',
        type: 'TEXT',
        visible: true,
        bbox: { x: 80, y: 120, width: 920, height: 160 },
        constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
        text: {
          characters: 'Безлимит на всё',
          fontSize: 72,
          font: { family: 'Beeline Sans', style: 'Bold' },
          lineHeight: 80,
          align: 'LEFT',
          autoResize: 'HEIGHT',
          mixed: false,
          textStyle: { id: 'S:1', key: 'abc', name: 'Heading/H1' },
        },
        fills: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: '#000000',
            variable: { id: 'V:1', key: 'k1', name: 'color/text/primary' },
          },
        ],
      },
      {
        id: '1:3',
        name: 'Button',
        type: 'INSTANCE',
        visible: true,
        bbox: { x: 80, y: 900, width: 280, height: 64 },
        component: {
          key: 'btn-key',
          name: 'Size=L, State=Default',
          componentSetName: 'Button',
          libraryName: '06_Carnica-UI-kit-WEB',
          isRemote: true,
          variantProps: { Size: 'L', State: 'Default' },
          componentProps: { Label: 'Подключить' },
          overriddenNodeIds: [],
        },
      },
    ],
  },
};

describe('DesignIR', () => {
  it('принимает валидное описание с вложенными узлами', () => {
    const parsed = DesignIRSchema.parse(banner);
    expect(indexNodes(parsed.root).size).toBe(3);
  });

  it('отклоняет узел без bbox', () => {
    const bad = structuredClone(banner) as unknown as { root: { children: Array<Record<string, unknown>> } };
    delete bad.root.children[0]!.bbox;
    expect(DesignIRSchema.safeParse(bad).success).toBe(false);
  });

  it('отклоняет неизвестный тип узла', () => {
    const bad = structuredClone(banner);
    (bad.root as { type: string }).type = 'WIDGET';
    expect(DesignIRSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RoleMap', () => {
  it('принимает роли с приоритетом 0–100', () => {
    expect(
      RoleMapSchema.safeParse({
        roles: { '1:2': { role: 'heading', priority: 90 }, '1:3': { role: 'cta', priority: 95 } },
      }).success,
    ).toBe(true);
  });

  it('отклоняет неизвестную роль и приоритет вне диапазона', () => {
    expect(RoleMapSchema.safeParse({ roles: { a: { role: 'banana', priority: 10 } } }).success).toBe(false);
    expect(RoleMapSchema.safeParse({ roles: { a: { role: 'cta', priority: 150 } } }).success).toBe(false);
  });
});

describe('PlanTemplate / LayoutPlan', () => {
  it('принимает шаблон с операциями и заполняет значения по умолчанию', () => {
    const t = PlanTemplateSchema.parse({
      sizeClass: 'banner:strip',
      mode: 'banner',
      composition: 'row',
      operations: [{ op: 'swapVariant', nodeId: '1:3', props: { Size: 'S' } }],
    });
    expect(t.hide).toEqual([]);
    expect(t.order).toEqual([]);
  });

  it('отклоняет неизвестную операцию и неизвестную композицию', () => {
    expect(
      PlanTemplateSchema.safeParse({
        sizeClass: 'x',
        mode: 'banner',
        composition: 'row',
        operations: [{ op: 'explode', nodeId: '1' }],
      }).success,
    ).toBe(false);
    expect(PlanTemplateSchema.safeParse({ sizeClass: 'x', mode: 'banner', composition: 'spiral' }).success).toBe(false);
  });

  it('отклоняет фокус вне 0..1', () => {
    expect(
      PlanTemplateSchema.safeParse({
        sizeClass: 'x',
        mode: 'banner',
        composition: 'row',
        operations: [{ op: 'crop', nodeId: '1', focal: { x: 1.5, y: 0.5 } }],
      }).success,
    ).toBe(false);
  });

  it('LayoutPlan допускает высоту auto', () => {
    expect(
      LayoutPlanSchema.safeParse({
        targetId: 'web:360xauto',
        width: 360,
        height: 'auto',
        mode: 'web',
        sizeClass: 'web:mobile',
        composition: 'stack',
        operations: [],
        ai: false,
        fallbackReason: 'без AI: таймаут провайдера',
      }).success,
    ).toBe(true);
  });
});

describe('JSON Schema для LLM', () => {
  it('генерируется для RoleMap и PlanTemplate', () => {
    const roles = roleMapJsonSchema();
    const plan = planTemplateJsonSchema();
    expect(roles.type).toBe('object');
    expect(plan.type).toBe('object');
    expect(JSON.stringify(plan)).toContain('swapVariant');
    expect(JSON.stringify(roles)).toContain('hero-image');
  });
});
